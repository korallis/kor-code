import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Execution, KorRunSnapshot, KorStatusResponse, KorStatusSnapshot, RunStatus, SessionProcessIdentity } from "@kor-code/core";
import type { KorConfig, KorPaths } from "@kor-code/config";
import { ExecutionVerificationError, type Controller } from "@kor-code/controller";
import type { LinearClient, LinearIssue } from "@kor-code/linear";
import { LinearStore, type AssignmentRecord, type ExecutionClaim } from "@kor-code/linear";
import { captureProcess, processExists, processMatches, stopSession } from "./process.js";

export { readSnapshot, readStatus } from "./status.js";
const exec = promisify(execFile);
export interface DaemonRunInput {
  claim: ExecutionClaim;
  issue: LinearIssue;
  /** The runner must settle only after its work has stopped. */
  signal: AbortSignal;
  onSpawn: (pid: number) => void;
}
export type DaemonRunner = (input: DaemonRunInput) => Promise<void | { execution: Execution }>;
export interface DaemonOptions {
  paths: KorPaths;
  config: KorConfig;
  store?: LinearStore;
  linear?: LinearClient;
  controller?: Controller;
  runner?: DaemonRunner;
  host?: string;
  port?: number;
  leaseTtlMs?: number;
  now?: () => number;
  pollIntervalMs?: number;
  owner?: string;
}
export interface ReconciliationResult { requeued: string[]; killedPids: number[]; orphanedWorktrees: string[] }
export interface DaemonHandle { readonly daemon: KorDaemon; readonly server: Server; stop(): Promise<void> }
interface ActiveRun { claim: ExecutionClaim; abort: AbortController; done: Promise<void> }
const markerSchema = z.object({ executionId: z.string().regex(/^[\w-]+$/), path: z.string(), repository: z.string() });

function safeMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "unknown daemon error"; }
function teamKeys(config: KorConfig): string[] { return [...new Set(Object.keys(config.repos).map(key => key.split("/", 1)[0] ?? key))].filter(Boolean); }
function runStatus(assignment: AssignmentRecord, observedAt: string): RunStatus {
  const manifest = assignment.manifest;
  return {
    executionId: assignment.executionId, issueId: assignment.issueId, status: assignment.status, attempts: assignment.attempts, observedAt,
    ...(assignment.issueKey ? { issueKey: assignment.issueKey } : {}),
    ...(assignment.issueTitle ? { issueTitle: assignment.issueTitle } : {}),
    ...(manifest?.route ? { route: manifest.route } : {}),
    ...(manifest?.status ? { phase: manifest.status } : {}),
    ...(assignment.cancelRequested ? { cancelRequested: true } : {}),
    ...(assignment.status === "failed" ? { errorCode: "execution_failed" } : {}),
    ...(assignment.status === "blocked" ? { errorCode: "verification_blocked" } : {}),
    ...(assignment.status === "canceled" ? { errorCode: "canceled" } : {}),
    ...(manifest?.repository ? { repository: manifest.repository } : {}),
    ...(manifest?.worktree ? { worktree: manifest.worktree } : {}),
    ...(manifest?.branch ? { branch: manifest.branch } : {}),
    ...(assignment.sessionPid ? { sessionPid: assignment.sessionPid } : {}),
    ...(assignment.heartbeatAt ? { heartbeatAt: new Date(assignment.heartbeatAt).toISOString() } : {}),
    ...(assignment.lastError ? { error: assignment.lastError } : {}),
  };
}

/** One process owns recovery and scheduling for a database. Claims stay fenced until work stops. */
export class KorDaemon {
  readonly store: LinearStore;
  private readonly now: () => number;
  private readonly owner: string;
  private readonly leaseTtlMs: number;
  private readonly pollIntervalMs: number;
  private readonly host: string;
  private readonly port: number;
  private readonly active = new Map<string, ActiveRun>();
  private readonly startedAt: string;
  private readonly runFiles = new Map<string, string>();
  private lastPollAt: string | undefined;
  private lastError: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cycle: Promise<void> = Promise.resolve();
  private snapshotWrite: Promise<void> = Promise.resolve();
  private server: Server | undefined;
  private ownsStore = false;
  private stopping = false;
  private stopPromise: Promise<void> | undefined;
  private poll: Promise<number> | undefined;

  constructor(private readonly options: DaemonOptions) {
    this.now = options.now ?? Date.now;
    this.owner = options.owner ?? `kor-daemon-${process.pid}-${randomUUID()}`;
    this.leaseTtlMs = options.leaseTtlMs ?? 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? options.config.pollIntervalSeconds * 1_000;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8327;
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs < 100) throw new Error("Lease TTL must be at least 100ms");
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 100) throw new Error("Poll interval must be at least 100ms");
    if (this.host !== "127.0.0.1") throw new Error("Status must bind to 127.0.0.1");
    if (!Number.isSafeInteger(this.port) || this.port < 0 || this.port > 65_535 || this.port === 8317) throw new Error("Status port must be a valid non-8317 port");
    this.store = options.store ?? new LinearStore(options.paths.databaseFile);
    this.startedAt = new Date(this.now()).toISOString();
  }

  async start(): Promise<DaemonHandle> {
    try {
      const previous = this.store.daemonOwner();
      if (previous && processMatches(previous.process)) throw new Error("A Kor daemon already owns this database");
      if (!this.store.acquireDaemon(this.owner, captureProcess(process.pid), previous?.owner)) throw new Error("Another Kor daemon acquired this database");
      this.ownsStore = true;
      await mkdir(this.options.paths.snapshotsDir, { recursive: true, mode: 0o700 });
      await mkdir(this.options.paths.logsDir, { recursive: true, mode: 0o700 });
      await this.reconcile();
      const server = createServer((request, response) => {
        const address = server.address();
        const port = address && typeof address !== "string" ? address.port : this.port;
        if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) { response.writeHead(403).end(); return; }
        if (request.method !== "GET" || !["/status", "/status/"].includes(request.url ?? "")) { response.writeHead(404).end(); return; }
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(`${JSON.stringify(this.response())}\n`);
      });
      this.server = server;
      await new Promise<void>((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(this.port, this.host, () => { server.off("error", reject); resolvePromise(); });
      });
      await this.tick();
      this.timer = setInterval(() => { void this.tick(); }, 100);
      return { daemon: this, server, stop: () => this.stop() };
    } catch (error) {
      if (this.ownsStore) this.store.releaseDaemon(this.owner);
      this.ownsStore = false;
      this.store.close();
      throw error;
    }
  }

  stop(): Promise<void> { return this.stopPromise ??= this.shutdown(); }
  private async shutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const run of this.active.values()) run.abort.abort(new Error("daemon stopping"));
    await this.cycle;
    await this.poll;
    await Promise.all([...this.active.values()].map(run => run.done));
    await this.writeSnapshot();
    if (this.server) await new Promise<void>(resolvePromise => this.server?.close(() => resolvePromise()));
    if (this.ownsStore) this.store.releaseDaemon(this.owner);
    this.ownsStore = false;
    this.store.close();
  }

  async reconcile(): Promise<ReconciliationResult> {
    if (!this.ownsStore) throw new Error("Recovery requires exclusive daemon ownership");
    const result: ReconciliationResult = { requeued: [], killedPids: [], orphanedWorktrees: [] };
    for (const assignment of this.store.listAssignments()) {
      if (assignment.status !== "running" && assignment.status !== "queued") continue;
      if (assignment.processIdentity) {
        const existed = processMatches(assignment.processIdentity);
        try { await stopSession(assignment.processIdentity); }
        catch (error) { await this.reportError(new Error(`recovery could not stop ${assignment.executionId}: ${safeMessage(error)}`)); continue; }
        if (existed) result.killedPids.push(assignment.processIdentity.pid);
      } else if (assignment.sessionPid && processExists(assignment.sessionPid)) {
        throw new Error(`Cannot recover ${assignment.executionId}: legacy session PID has no identity; waiting for it to exit`);
      }
      if (assignment.status === "running" || assignment.expiresAt !== undefined) {
        this.store.recover(assignment.issueId, "daemon restarted; previous session stopped; re-queued");
        result.requeued.push(assignment.issueId);
        await this.log(assignment.executionId, "daemon restarted; previous session stopped; re-queued");
      }
    }
    result.orphanedWorktrees = await this.removeOrphanWorktrees();
    await this.writeSnapshot();
    return result;
  }

  pollOnce(): Promise<number> {
    if (this.poll) return this.poll;
    this.poll = this.pollIssues().finally(() => { this.poll = undefined; });
    return this.poll;
  }
  private async pollIssues(): Promise<number> {
    try {
      let found = 0;
      if (this.options.linear) for (const key of teamKeys(this.options.config)) {
        const issues = await this.options.linear.listIssues(key, 100);
        for (const issue of issues) {
          if (this.stopping) break;
          if (issue.stateType !== "unstarted" || !issue.labels.some(label => label.toLowerCase() === this.options.config.intakeLabel.toLowerCase())) continue;
          this.store.enqueue(issue.id);
          found++;
        }
      }
      this.lastPollAt = new Date(this.now()).toISOString();
      this.lastError = undefined;
      return found;
    } catch (error) {
      this.lastPollAt = new Date(this.now()).toISOString();
      await this.reportError(error);
      return 0;
    }
  }
  async enqueue(issueId: string): Promise<AssignmentRecord> {
    const assignment = this.store.enqueue(issueId);
    await this.writeSnapshot();
    return this.store.listAssignments().find(item => item.issueId === issueId) ?? { ...assignment, attempts: 0 };
  }
  cancel(issueId: string): boolean { return this.store.requestCancel(issueId); }
  retry(issueId: string): boolean { return this.store.retry(issueId); }
  status(): KorStatusSnapshot {
    const observedAt = new Date(this.now()).toISOString();
    return { schemaVersion: 1, observedAt,
      daemon: { pid: process.pid, startedAt: this.startedAt, pollIntervalSeconds: this.pollIntervalMs / 1_000, ...(this.lastPollAt ? { lastPollAt: this.lastPollAt } : {}), ...(this.lastError ? { lastError: this.lastError } : {}) },
      runs: this.store.listAssignments().map(assignment => runStatus(assignment, observedAt)),
    };
  }
  response(): KorStatusResponse { const snapshot = this.status(); return { schemaVersion: 1, provenance: "live", observedAt: snapshot.observedAt, snapshot }; }

  private busy = false;
  private tick(): Promise<void> {
    if (this.busy || this.stopping) return this.cycle;
    this.busy = true;
    this.cycle = (async () => {
      if (!this.lastPollAt || this.now() - Date.parse(this.lastPollAt) >= this.pollIntervalMs) void this.pollOnce();
      if (this.options.linear && (this.options.runner || this.options.controller)) {
        while (!this.stopping && this.active.size < this.options.config.limits.total) {
          const claim = this.store.claim(this.owner, this.leaseTtlMs, undefined, [...this.active.keys()]);
          if (!claim) break;
          const abort = new AbortController();
          const run: ActiveRun = { claim, abort, done: Promise.resolve() };
          this.active.set(claim.assignment.issueId, run);
          run.done = this.execute(run).catch(error => this.reportError(error)).finally(() => { this.active.delete(claim.assignment.issueId); });
        }
      }
      await this.writeSnapshot();
    })().catch(error => this.reportError(error)).finally(() => { this.busy = false; });
    return this.cycle;
  }

  private async execute(run: ActiveRun): Promise<void> {
    const { claim, abort } = run;
    const id = claim.assignment.executionId;
    let identity: SessionProcessIdentity | undefined;
    let result: void | { execution: Execution } = undefined;
    let failure: unknown;
    const heartbeat = setInterval(() => {
      try {
        if (this.store.isCancelRequested(claim.assignment.issueId)) abort.abort(new Error("canceled by operator"));
        this.store.heartbeat(claim, this.leaseTtlMs);
      } catch (error) { abort.abort(error); }
    }, Math.max(25, Math.floor(this.leaseTtlMs / 3)));
    const onSpawn = (pid: number) => {
      const captured = captureProcess(pid);
      identity = captured;
      this.store.setSessionPid(claim, pid, captured);
      abort.signal.throwIfAborted();
    };
    try {
      await this.log(id, "execution started");
      if (!this.options.linear) throw new Error("Linear client unavailable");
      const issue = await this.options.linear.getIssue(claim.assignment.issueId);
      this.store.setIssueMetadata(claim, issue.identifier ?? issue.id, issue.title);
      this.store.markRunning(claim, { id, issueId: issue.id, repository: issue.repository ?? issue.teamKey, worktree: "", branch: `kor/${issue.id}`, status: "running", route: this.options.config.defaultRoute });
      abort.signal.throwIfAborted();
      if (this.options.runner) result = await this.options.runner({ claim, issue, onSpawn, signal: abort.signal });
      else if (this.options.controller) result = await this.options.controller.dispatch({ id, issueId: issue.id, repository: issue.repository ?? issue.teamKey, worktree: "", branch: `kor/${issue.id}`, status: "queued", issue, claim, onSpawn, signal: abort.signal });
      else throw new Error("Daemon controller unavailable");
      abort.signal.throwIfAborted();
    } catch (error) { failure = error; }
    finally { clearInterval(heartbeat); }
    // Do not release a claim while any tracked session group might still mutate its worktree.
    let cleanupFailure: unknown;
    if (identity) {
      try { await stopSession(identity); }
      catch (error) { cleanupFailure = error; }
    }
    if (cleanupFailure !== undefined) {
      this.store.clearCancel(claim.assignment.issueId);
      this.store.failClaim(claim, `session cleanup failed: ${safeMessage(cleanupFailure)}`);
    } else if (this.store.isCancelRequested(claim.assignment.issueId)) this.store.cancelClaim(claim);
    else if (this.stopping) this.store.recover(claim.assignment.issueId, "daemon stopped; session stopped; re-queued");
    else if (failure !== undefined) this.store.failClaim(claim, safeMessage(failure), failure instanceof ExecutionVerificationError ? "blocked" : "failed");
    else if (result?.execution.status === "failed" || result?.execution.status === "blocked") this.store.finishClaim(claim, result.execution.status, "execution did not complete", result.execution);
    else if (result && result.execution.status !== "complete") this.store.failClaim(claim, `Unexpected execution outcome: ${result.execution.status}`);
    else this.store.completeClaim(claim, result?.execution);
    await this.log(id, `execution ${this.store.getAssignment(claim.assignment.issueId).status}${failure ? `: ${safeMessage(failure)}` : ""}`);
  }

  private writeSnapshot(): Promise<void> {
    const write = async () => {
      const snapshot = this.status();
      await mkdir(this.options.paths.snapshotsDir, { recursive: true, mode: 0o700 });
      for (const run of snapshot.runs) {
        const signature = JSON.stringify({ ...run, observedAt: undefined });
        if (this.runFiles.get(run.executionId) === signature) continue;
        const file: KorRunSnapshot = { schemaVersion: 1, observedAt: snapshot.observedAt, run };
        await this.atomicWrite(join(this.options.paths.snapshotsDir, `${run.executionId}.json`), file);
        this.runFiles.set(run.executionId, signature);
      }
      await this.atomicWrite(join(this.options.paths.snapshotsDir, "index.json"), snapshot);
    };
    this.snapshotWrite = this.snapshotWrite.catch(() => undefined).then(write);
    return this.snapshotWrite;
  }
  private async atomicWrite(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  private async removeOrphanWorktrees(): Promise<string[]> {
    const root = resolve(this.options.paths.worktreesDir);
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const known = new Set(this.store.listAssignments().map(item => item.executionId));
    const repositories = new Set(Object.values(this.options.config.repos).map(repository => resolve(repository.path)));
    const removed: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".kor-worktree.json")) continue;
      const marker = join(root, entry.name);
      const parsed = markerSchema.safeParse(JSON.parse(await readFile(marker, "utf8").catch(() => "null")));
      if (!parsed.success) continue;
      const value = parsed.data;
      if (known.has(value.executionId) || !repositories.has(resolve(value.repository)) || resolve(value.path) !== join(root, value.executionId)) continue;
      try { await exec("git", ["-C", value.repository, "worktree", "remove", "--force", value.path]); }
      catch { continue; }
      await unlink(marker);
      removed.push(value.path);
    }
    return removed;
  }
  private async reportError(error: unknown): Promise<void> {
    this.lastError = safeMessage(error);
    await this.log("daemon", this.lastError).catch(() => undefined);
  }
  private async log(id: string, message: string): Promise<void> {
    await mkdir(this.options.paths.logsDir, { recursive: true, mode: 0o700 });
    await appendFile(join(this.options.paths.logsDir, `${basename(id)}.log`), `${new Date(this.now()).toISOString()} ${message}\n`, { mode: 0o600 });
  }
  async readLog(id: string): Promise<string> {
    try { return await readFile(join(this.options.paths.logsDir, `${basename(id)}.log`), "utf8"); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""; throw error; }
  }
}
export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> { return new KorDaemon(options).start(); }
