import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { KorStatusResponse, KorStatusSnapshot, RunStatus } from "@kor-code/core";
import type { KorConfig, KorPaths } from "@kor-code/config";
import type { Controller, ControllerRunResult } from "@kor-code/controller";
import type { LinearClient, LinearIssue } from "@kor-code/linear";
import { LinearStore, type AssignmentRecord, type ExecutionClaim } from "@kor-code/linear";

export interface DaemonRunInput {
  claim: ExecutionClaim;
  issue: LinearIssue;
  onSpawn: (pid: number) => void;
}

export type DaemonRunner = (input: DaemonRunInput) => Promise<unknown>;

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
  /** Polling is intentionally injectable so a live run can be proven quickly. */
  pollIntervalMs?: number;
  owner?: string;
}

export interface ReconciliationResult {
  requeued: string[];
  killedPids: number[];
  orphanedWorktrees: string[];
}

export interface DaemonHandle {
  readonly daemon: KorDaemon;
  readonly server: Server;
  stop(): Promise<void>;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown daemon error";
}

function runningPid(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function stopPid(pid: number): Promise<boolean> {
  if (!runningPid(pid)) return false;
  try { process.kill(pid, "SIGTERM"); } catch { return false; }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!runningPid(pid)) return true;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* the process exited during the grace period */ }
  return true;
}

function teamKeys(config: KorConfig): string[] {
  const keys = Object.keys(config.repos).map(key => key.split("/", 1)[0] ?? key);
  return [...new Set(keys)].filter(Boolean);
}

function hasIntakeLabel(issue: LinearIssue, label: string): boolean {
  return issue.labels.some(candidate => candidate.toLocaleLowerCase() === label.toLocaleLowerCase());
}

function runStatus(assignment: AssignmentRecord, observedAt: string): RunStatus {
  const manifest = assignment.manifest;
  const manifestStatus = manifest?.status;
  const status: RunStatus["status"] = assignment.cancelRequested ? "canceled"
    : manifestStatus === "blocked" ? "blocked"
      : manifestStatus === "failed" ? "failed"
        : assignment.status === "complete" ? "complete"
          : assignment.status === "running" ? "running" : "queued";
  return {
    executionId: assignment.executionId,
    issueId: assignment.issueId,
    status,
    attempts: assignment.attempts,
    ...(manifest?.repository ? { repository: manifest.repository } : {}),
    ...(manifest?.worktree ? { worktree: manifest.worktree } : {}),
    ...(manifest?.branch ? { branch: manifest.branch } : {}),
    ...(assignment.sessionPid ? { sessionPid: assignment.sessionPid } : {}),
    ...(assignment.heartbeatAt ? { heartbeatAt: new Date(assignment.heartbeatAt).toISOString() } : {}),
    ...(assignment.lastError ? { error: assignment.lastError } : {}),
    observedAt,
  };
}

/**
 * The durable coordinator. It owns intake, leases, recovery and the read-only
 * status transport; the controller remains responsible for executing a claim.
 */
export class KorDaemon {
  readonly store: LinearStore;
  private readonly now: () => number;
  private readonly owner: string;
  private readonly leaseTtlMs: number;
  private readonly pollIntervalMs: number;
  private readonly host: string;
  private readonly port: number;
  private readonly running = new Set<string>();
  private readonly startedAt: string;
  private lastPollAt: string | undefined;
  private lastError: string | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pumpTimer: ReturnType<typeof setInterval> | undefined;
  private server: Server | undefined;
  private stopping = false;

  constructor(private readonly options: DaemonOptions) {
    this.store = options.store ?? new LinearStore(options.paths.databaseFile);
    this.now = options.now ?? Date.now;
    this.owner = options.owner ?? `kor-daemon-${process.pid}-${randomUUID()}`;
    this.leaseTtlMs = options.leaseTtlMs ?? 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? options.config.pollIntervalSeconds * 1_000;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8327;
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs <= 0) throw new Error("Lease TTL must be positive");
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 100) throw new Error("Poll interval must be at least 100ms");
    if (!Number.isSafeInteger(this.port) || this.port < 0 || this.port > 65_535 || this.port === 8317) throw new Error("Status port must be a valid non-8317 port");
    this.startedAt = new Date(this.now()).toISOString();
  }

  async start(): Promise<DaemonHandle> {
    await mkdir(this.options.paths.snapshotsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.options.paths.logsDir, { recursive: true, mode: 0o700 });
    await this.reconcile();
    this.server = createServer((request, response) => this.handleHttp(request, response));
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => { this.server?.off("listening", resolvePromise); reject(error); };
      this.server?.once("error", onError);
      this.server?.listen(this.port, this.host, () => { this.server?.off("error", onError); resolvePromise(); });
    });
    await this.pollOnce();
    await this.pump();
    this.pollTimer = setInterval(() => { void this.pollOnce(); }, this.pollIntervalMs);
    this.pumpTimer = setInterval(() => { void this.pump(); }, Math.min(1_000, this.pollIntervalMs));
    this.pollTimer.unref?.(); this.pumpTimer.unref?.();
    return { daemon: this, server: this.server, stop: () => this.stop() };
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    if (this.server) await new Promise<void>(resolvePromise => this.server?.close(() => resolvePromise()));
    this.store.close();
  }

  async reconcile(): Promise<ReconciliationResult> {
    const requeued: string[] = [];
    const killedPids: number[] = [];
    for (const assignment of this.store.listAssignments()) {
      if (assignment.status === "complete") continue;
      if (assignment.sessionPid && await stopPid(assignment.sessionPid)) killedPids.push(assignment.sessionPid);
      const expired = assignment.expiresAt !== undefined && assignment.expiresAt <= this.now();
      if (assignment.sessionPid || expired || assignment.status === "running") {
        if (this.store.requeue(assignment.issueId, 0, assignment.sessionPid ? "daemon restarted; session re-queued" : undefined)) requeued.push(assignment.issueId);
      }
    }
    const orphanedWorktrees = await this.removeOrphanWorktrees();
    await this.writeSnapshot();
    return { requeued, killedPids, orphanedWorktrees };
  }

  async pollOnce(): Promise<number> {
    if (!this.options.linear) {
      this.lastPollAt = new Date(this.now()).toISOString();
      return 0;
    }
    try {
      let found = 0;
      for (const teamKey of teamKeys(this.options.config)) {
        const issues = await this.options.linear.listIssues(teamKey, 100);
        for (const issue of issues) {
          if (issue.stateType !== "unstarted" || !hasIntakeLabel(issue, this.options.config.intakeLabel)) continue;
          this.store.enqueue(issue.id);
          found++;
        }
      }
      this.lastPollAt = new Date(this.now()).toISOString();
      this.lastError = undefined;
      await this.writeSnapshot();
      return found;
    } catch (error) {
      this.lastPollAt = new Date(this.now()).toISOString();
      this.lastError = safeMessage(error);
      await this.log("daemon", `poll failed: ${this.lastError}`);
      await this.writeSnapshot();
      return 0;
    }
  }

  async enqueue(issueId: string): Promise<AssignmentRecord> {
    this.store.enqueue(issueId);
    await this.writeSnapshot();
    return this.store.listAssignments().find(item => item.issueId === issueId) ?? this.store.listAssignments()[0]!;
  }

  cancel(issueId: string): boolean {
    const accepted = this.store.requestCancel(issueId);
    if (accepted) void this.writeSnapshot();
    return accepted;
  }

  retry(issueId: string): boolean {
    const retried = this.store.requeue(issueId, 0);
    if (retried) void this.writeSnapshot();
    return retried;
  }

  status(): KorStatusSnapshot {
    const observedAt = new Date(this.now()).toISOString();
    return {
      schemaVersion: 1,
      observedAt,
      daemon: { pid: process.pid, startedAt: this.startedAt, pollIntervalSeconds: this.options.config.pollIntervalSeconds, ...(this.lastPollAt ? { lastPollAt: this.lastPollAt } : {}), ...(this.lastError ? { lastError: this.lastError } : {}) },
      runs: this.store.listAssignments().map(assignment => runStatus(assignment, observedAt)),
    };
  }

  response(): KorStatusResponse {
    return { schemaVersion: 1, provenance: "live", observedAt: new Date(this.now()).toISOString(), snapshot: this.status() };
  }

  private async pump(): Promise<void> {
    if (this.stopping) return;
    if (!this.options.linear || (!this.options.runner && !this.options.controller)) return;
    const max = this.options.config.limits.total;
    while (this.running.size < max) {
      const claim = this.store.claim(this.owner, this.leaseTtlMs);
      if (!claim) break;
      if (this.store.isCancelRequested(claim.assignment.issueId)) {
        this.store.requeue(claim.assignment.issueId, 0, "canceled before execution");
        continue;
      }
      const issue = await this.options.linear.getIssue(claim.assignment.issueId);
      this.store.markRunning(claim);
      this.running.add(claim.assignment.issueId);
      const run = this.options.runner
        ? this.options.runner({ claim, issue, onSpawn: pid => this.store.setSessionPid(claim, pid) })
        : this.runController(claim, issue);
      void run.then(() => {
        try { this.store.completeClaim(claim); } catch { /* a restart already reclaimed this lease */ }
      }).catch(error => {
        const message = safeMessage(error);
        try { this.store.requeue(claim.assignment.issueId, 1_000, message); } catch { /* reconcile handles an expired lease */ }
        void this.log(claim.assignment.issueId, `execution failed: ${message}`);
      }).finally(() => {
        this.running.delete(claim.assignment.issueId);
        void this.writeSnapshot();
      });
    }
    await this.writeSnapshot();
  }

  private async runController(claim: ExecutionClaim, issue: LinearIssue): Promise<ControllerRunResult> {
    if (!this.options.controller) throw new Error("Daemon controller is unavailable");
    const result = await this.options.controller.dispatch({ id: claim.assignment.executionId, issueId: issue.id, repository: issue.repository ?? issue.teamKey, worktree: "", branch: `kor/${issue.id}`, status: "queued", issue, claim, onSpawn: pid => this.store.setSessionPid(claim, pid) });
    return result;
  }

  private async writeSnapshot(): Promise<void> {
    const snapshot = this.status();
    const index = join(this.options.paths.snapshotsDir, "index.json");
    const temporary = `${index}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, index);
    for (const run of snapshot.runs) {
      const path = join(this.options.paths.snapshotsDir, `${run.executionId}.json`);
      const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify({ schemaVersion: 1, observedAt: snapshot.observedAt, run }, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, path);
    }
  }

  private async removeOrphanWorktrees(): Promise<string[]> {
    const root = this.options.paths.worktreesDir;
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
    const known = new Set(this.store.listAssignments().map(item => item.manifest?.worktree).filter((value): value is string => Boolean(value)).map(value => resolve(value)));
    const removed: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name);
      const marker = join(path, ".kor-worktree.json");
      try { await stat(marker); } catch { continue; }
      if (known.has(resolve(path))) continue;
      await rm(path, { recursive: true, force: true });
      removed.push(path);
    }
    return removed;
  }

  private async log(id: string, message: string): Promise<void> {
    await mkdir(this.options.paths.logsDir, { recursive: true, mode: 0o700 });
    await appendFile(join(this.options.paths.logsDir, `${basename(id)}.log`), `${new Date(this.now()).toISOString()} ${message}\n`, { mode: 0o600 });
  }

  async readLog(id: string): Promise<string> {
    try { return await readFile(join(this.options.paths.logsDir, `${basename(id)}.log`), "utf8"); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""; throw error; }
  }

  private handleHttp(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): void {
    if (request.method !== "GET" || (request.url !== "/status" && request.url !== "/status/")) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(`${JSON.stringify(this.response())}\n`);
  }
}

export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  const daemon = new KorDaemon(options);
  return daemon.start();
}

export async function readSnapshot(paths: KorPaths): Promise<KorStatusSnapshot | undefined> {
  try { return JSON.parse(await readFile(join(paths.snapshotsDir, "index.json"), "utf8")) as KorStatusSnapshot; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw error; }
}

export async function readStatus(paths: KorPaths, maxAgeMs = 120_000, now = Date.now): Promise<KorStatusResponse> {
  const observedAt = new Date(now()).toISOString();
  try {
    const snapshot = JSON.parse(await readFile(join(paths.snapshotsDir, "index.json"), "utf8")) as KorStatusSnapshot;
    const timestamp = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(timestamp)) return { schemaVersion: 1, provenance: "unavailable", observedAt, snapshot: null, reason: "snapshot timestamp is invalid" };
    const age = Math.max(0, now() - timestamp);
    return { schemaVersion: 1, provenance: age <= maxAgeMs ? "live" : "stale", observedAt, snapshot, ...(age > maxAgeMs ? { reason: `snapshot is ${Math.floor(age / 1_000)}s old` } : {}) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { schemaVersion: 1, provenance: "unavailable", observedAt, snapshot: null, reason: "daemon has not published a snapshot" };
    return { schemaVersion: 1, provenance: "unavailable", observedAt, snapshot: null, reason: "daemon snapshot is unreadable" };
  }
}
