import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { DecisionRecord, Execution, GatewayAccountHealth, KorRunSnapshot, KorStatusResponse, KorStatusSnapshot, Labelled, OverrideRecord, Route, RouteSource, RunStatus, SessionProcessIdentity } from "@kor-code/core";
import { repositoryKeyForIssue, type KorConfig, type KorPaths } from "@kor-code/config";
import { ExecutionVerificationError, type Controller } from "@kor-code/controller";
import type { LinearClient, LinearIssue } from "@kor-code/linear";
import { AgentSessionWriter, LinearStore, flushLinearWrites, stableId, workflowMapping, type LinearWrite, type AssignmentRecord, type ExecutionClaim } from "@kor-code/linear";
import { captureProcess, processExists, processMatches, stopSession } from "./process.js";
import { OverrideStore } from "./overrides.js";
import type { ShippingDriver } from "./shipping.js";
export { GitHubShipping, type ShippingDriver, type ShippingCommand } from "./shipping.js";

export { OverrideStore } from "./overrides.js";

export { readSnapshot, readStatus, readExecutionStatus } from "./status.js";
const exec = promisify(execFile);
export class NeedsInputError extends Error {}
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
  /** When enabled, verified executions remain shipping/review until GitHub reports a merge. */
  shipping?: ShippingDriver;
  runner?: DaemonRunner;
  host?: string;
  port?: number;
  leaseTtlMs?: number;
  now?: () => number;
  pollIntervalMs?: number;
  owner?: string;
  /** Account health from the gateway's management API, refreshed on every poll. */
  gateway?: { accountHealth(): Promise<GatewayAccountHealth[]> };
  /** Models the compatibility probe verified; a route override must name one. */
  verifiedModels?: () => Promise<string[]>;
  /**
   * Plans an execution's route or replays its durable preflight on retry. A thrown
   * error leaves the configured default standing, labelled `fallback`; it never
   * fails the run.
   */
  chooseRoute?: (input: { executionId: string; issue: LinearIssue }) => Promise<RouteChoice>;
}
export interface RouteChoice { route: Route; source: RouteSource }
/** What `POST /overrides` accepts from the cockpit. */
export interface OverrideRequest { executionId: string; target: string; choice: string; decisionId?: string; origin?: string }
export interface OverrideAnswer { status: number; record?: OverrideRecord; error?: string }
interface IssueFacts { key: string; title: string; url?: string; state?: string }
interface RunFacts { issue?: IssueFacts; route?: Route; routeSource?: RouteSource; decisions: DecisionRecord[] }
export interface ReconciliationResult { requeued: string[]; killedPids: number[]; orphanedWorktrees: string[] }
export interface DaemonHandle { readonly daemon: KorDaemon; readonly server: Server; stop(): Promise<void> }
interface ActiveRun { claim: ExecutionClaim; abort: AbortController; done: Promise<void> }
const markerSchema = z.object({ executionId: z.string().regex(/^[\w-]+$/), path: z.string(), repository: z.string() });

function safeMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "unknown daemon error"; }
/** The Linear teams to poll: each repository's `linearTeam`, else its map key's team part. */
function teamKeys(config: KorConfig): string[] {
  return [...new Set(Object.entries(config.repos).map(([key, repository]) => repository.linearTeam ?? key.split("/", 1)[0] ?? key))].filter(Boolean);
}
const FINISHED = new Set<RunStatus["status"]>(["complete", "canceled", "failed"]);
function overrideComment(record: OverrideRecord): string {
  const verb = record.status === "reverted" ? "reverted" : "applied";
  return [
    `**Kor override ${record.id} ${verb}** from the ${record.origin}: \`${record.target}\` → \`${record.choice}\`${record.previous ? ` (was \`${record.previous}\`)` : ""}.`,
    `Execution \`${record.executionId}\`. ${record.reason}`,
    `Policy: ${record.policyChecks.map(check => `${check.name} ${check.result}`).join("; ") || "none"}.`,
  ].join("\n\n");
}
function runStatus(assignment: AssignmentRecord, observedAt: string, facts: RunFacts = { decisions: [] }): RunStatus {
  const manifest = assignment.manifest;
  const blockedErrorCode = assignment.lastError?.startsWith("Needs input:") || assignment.lastError?.startsWith("Add a # Acceptance section") ? "needs_input" : "verification_blocked";
  const route = facts.route ?? manifest?.route;
  const issue = facts.issue
    ? { key: facts.issue.key, title: facts.issue.title, ...(facts.issue.url ? { url: facts.issue.url } : {}), ...(facts.issue.state ? { state: facts.issue.state } : {}) }
    : assignment.issueKey || assignment.issueTitle
      ? { key: assignment.issueKey ?? assignment.issueId, title: assignment.issueTitle ?? assignment.issueKey ?? assignment.issueId }
      : undefined;
  return {
    executionId: assignment.executionId, issueId: assignment.issueId, status: assignment.status, attempts: assignment.attempts, observedAt,
    ...(issue ? { issueKey: issue.key, issueTitle: issue.title, ...(issue.url ? { issueUrl: issue.url } : {}), ...(issue.state ? { issueState: issue.state } : {}) } : {}),
    ...(route ? { route } : {}),
    ...(facts.routeSource ? { routeSource: facts.routeSource } : {}),
    ...(facts.decisions.length ? { decisionIds: facts.decisions.map(decision => decision.decisionId) } : {}),
    phase: assignment.status === "running" ? manifest?.status ?? assignment.status : assignment.status,
    ...(manifest?.verification ? { verification: manifest.verification } : {}),
    ...(manifest?.shipping ? { shipping: manifest.shipping } : {}),
    ...(manifest?.shipping && "url" in manifest.shipping.stage ? { pullRequestUrl: manifest.shipping.stage.url } : {}),
    ...(assignment.cancelRequested ? { cancelRequested: true } : {}),
    ...(assignment.status === "failed" ? { errorCode: "execution_failed" } : {}),
    ...(assignment.status === "blocked" ? { errorCode: manifest?.shipping ? "shipping_blocked" : blockedErrorCode } : {}),
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
  readonly overrides: OverrideStore;
  /** Issue facts by assignment issue ID, kept from polls and claims for display. */
  private readonly issues = new Map<string, IssueFacts>();
  private accounts: Labelled<GatewayAccountHealth[]> | undefined;

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
    this.overrides = new OverrideStore(options.paths.databaseFile, this.now);
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
        if (request.method === "POST") { this.handleOverride(request, response); return; }
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
      this.overrides.close();
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
    this.overrides.close();
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
    await this.refreshAccounts();
    await this.flushOverrideComments();
    try {
      if (this.options.linear) await flushLinearWrites(this.store, this.options.linear);
      await this.advanceShipping();
      let found = 0;
      if (this.options.linear) for (const key of teamKeys(this.options.config)) {
        const issues = await this.options.linear.listIssues(key, 100);
        for (const issue of issues) {
          if (this.stopping) break;
          this.remember(issue.id, issue);
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
  /** One daemon owns these stages; no execution lease or model session is reopened. */
  private async advanceShipping(): Promise<void> {
    const { shipping, linear } = this.options;
    if (!shipping || !linear) return;
    for (const assignment of this.store.listAssignments()) {
      const previous = assignment.manifest;
      if (this.stopping || !previous?.shipping) continue;
      if (!['shipping', 'review', 'blocked', 'complete', 'failed'].includes(assignment.status)) continue;
      try {
        const issue = await linear.getIssue(assignment.issueId);
        this.remember(assignment.issueId, issue);
        const repository = this.options.config.repos[previous.repository];
        if (!repository) throw new Error(`Shipping repository missing: ${previous.repository}`);
        const states = workflowMapping(await linear.listWorkflowStates(issue.teamKey));
        if (!states.review) throw new Error(`Linear team ${issue.teamKey} has no In Review state`);
        const writer = new AgentSessionWriter(this.store, linear, states);
        await writer.flush();
        let execution = await shipping.advance({ execution: previous, issue, repository });
        const report = execution.shipping;
        if (!report) throw new Error('Shipping driver lost its durable report');
        const changed = previous.shipping.stage.kind !== report.stage.kind || previous.status !== execution.status || previous.shipping.error !== report.error;
        const writes: LinearWrite[] = [];
        if (changed) {
          writes.push({ kind: 'label', issueId: issue.id, name: 'kor:blocked', present: execution.status === 'blocked' });
          const stage = report.stage;
          if (stage.kind === 'review' || stage.kind === 'merged') {
            writes.push({ kind: 'attachment', issueId: issue.id, url: stage.url, title: 'GitHub pull request' });
            writes.push({ kind: 'state', issueId: issue.id, stateId: stage.kind === 'merged' ? states.complete.id : states.review.id });
          }
          writes.push({ kind: 'comment', id: stableId('kor-shipping', `${execution.id}:${execution.status}`), issueId: issue.id,
            body: [`Kor execution ${execution.id}: ${execution.status}`, 'url' in stage ? stage.url : '', report.error ?? '', ...report.evidence.map(item => `${item.kind}: ${item.status} — ${item.summary}`)].filter(Boolean).join('\n') });
        }
        if (changed && (report.stage.kind === 'merged' || report.stage.kind === 'closed')) {
          this.options.controller?.recordTerminalOutcome(execution.id, { status: report.stage.kind === 'merged' ? 'merged' : 'rejected', recordedAt: new Date(this.now()).toISOString(), source: 'shipping.github-observed' });
        }
        this.store.updateShipping(execution, writes);
        await writer.flush();
        if (report.stage.kind === 'merged' && report.cleanup !== 'removed' && this.store.counts().pendingWrites === 0) {
          if (resolve(execution.worktree) !== join(resolve(this.options.paths.worktreesDir), execution.id)) throw new Error('Cleanup path is outside this execution worktree');
          execution = await shipping.cleanup({ execution, issue, repository });
          this.store.updateShipping(execution);
        }
        if (changed) await this.log(execution.id, `shipping ${execution.status}${report.error ? `: ${report.error}` : ''}`);
      } catch (error) {
        const current = this.store.listAssignments().find(item => item.executionId === assignment.executionId)?.manifest;
        if (current?.shipping) this.store.updateShipping({ ...current,
          status: current.status === 'complete' || current.status === 'failed' ? current.status : 'blocked',
          shipping: { ...current.shipping, error: `Synchronization will retry: ${safeMessage(error)}` },
        });
        await this.log(assignment.executionId, `shipping synchronization will retry: ${safeMessage(error)}`);
        await this.reportError(error);
      }
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
      runs: this.store.listAssignments().map(assignment => runStatus(assignment, observedAt, this.facts(assignment))),
      ...(this.accounts ? { accounts: this.accounts } : {}),
      decisions: { value: this.store.listAssignments().flatMap(assignment => this.overrides.decisions(assignment.executionId)), provenance: "live", observedAt },
      overrides: this.overrides.list().map(({ commentId: _, ...record }) => record),
    };
  }

  /** The display facts the queue does not hold: the issue, the route in force and why, Jev's decisions. */
  private facts(assignment: AssignmentRecord): RunFacts {
    const issue = this.issues.get(assignment.issueId);
    const decisions = this.overrides.decisions(assignment.executionId);
    const override = this.overrides.activeRoute(assignment.executionId);
    const base: Route = assignment.manifest?.route ?? this.options.config.defaultRoute;
    if (override) return { ...(issue ? { issue } : {}), route: { ...base, model: override.choice }, routeSource: "override", decisions };
    const decided = [...decisions].reverse().find(decision => decision.kind === "route");
    const routeSource: RouteSource = base.label === "fallback" || base.label === "escalated" ? "fallback" : !decided ? "config" : !decided.escalated && decided.choice === base.model ? "jev" : "fallback";
    return { ...(issue ? { issue } : {}), route: base, routeSource, decisions };
  }

  private remember(key: string, issue: LinearIssue): void {
    this.issues.set(key, { key: issue.identifier ?? issue.id, title: issue.title, ...(issue.url ? { url: issue.url } : {}), ...(issue.stateName ? { state: issue.stateName } : {}) });
  }

  /**
   * The account pool as the gateway's management API reports it. A failed read
   * never looks like a fresh empty pool: the last good read is kept as stale,
   * or the pool is unavailable, with the reason.
   */
  private async refreshAccounts(): Promise<void> {
    if (!this.options.gateway) return;
    const observedAt = new Date(this.now()).toISOString();
    try {
      this.accounts = { value: await this.options.gateway.accountHealth(), provenance: "live", observedAt };
    } catch (error) {
      const reason = `gateway management unreachable: ${safeMessage(error)}`;
      this.accounts = this.accounts && this.accounts.value.length > 0
        ? { ...this.accounts, provenance: "stale", reason }
        : { value: [], provenance: "unavailable", observedAt, reason };
    }
  }

  /**
   * Judges a cockpit override against policy, records it in the override audit
   * whatever the outcome, and comments on the Linear issue when it applies. A
   * route override takes effect from the execution's next attempt.
   */
  async override(request: OverrideRequest): Promise<OverrideAnswer> {
    const run = this.status().runs.find(one => one.executionId === request.executionId);
    if (!run) return { status: 404, error: `no execution ${request.executionId}` };
    const decisions = this.overrides.decisions(run.executionId);
    const isRoute = request.target === "route";
    const decision = isRoute ? undefined : decisions.find(one => one.decisionId === (request.decisionId ?? request.target) || one.kind === request.target);
    const checks: OverrideRecord["policyChecks"] = [{ name: "execution not finished", result: FINISHED.has(run.status) ? "fail" : "pass" }];
    let previous: string | undefined;
    if (isRoute) {
      const verified = this.options.verifiedModels ? await this.options.verifiedModels().catch(() => []) : [];
      checks.push({ name: "model verified by kor models probe", result: verified.includes(request.choice) ? "pass" : "fail" });
      checks.push({ name: "differs from the route in force", result: run.route?.model === request.choice ? "fail" : "pass" });
      previous = run.route?.model;
    } else if (decision) {
      checks.push({ name: "choice is a candidate of the decision", result: decision.candidates.includes(request.choice) ? "pass" : "fail" });
      previous = decision.choice;
    } else {
      checks.push({ name: "decision recorded for this execution", result: "fail" });
    }
    const failed = checks.filter(check => check.result === "fail").map(check => check.name);
    const applied = failed.length === 0;
    const record = this.overrides.record({
      executionId: run.executionId,
      issueId: run.issueId,
      target: isRoute ? "route" : decision?.decisionId ?? request.target,
      choice: request.choice,
      ...(previous ? { previous } : {}),
      status: applied ? "applied" : "rejected",
      reason: applied ? (isRoute ? "Applies from the next attempt; the running session keeps its model." : "Recorded against the decision for the next evaluation.") : `Policy refused it: ${failed.join(", ")}.`,
      policyChecks: checks,
      origin: (request.origin ?? "cockpit").slice(0, 40),
    });
    await this.log(run.executionId, `override ${record.id} ${record.status}: ${record.target} -> ${record.choice} (${record.reason})`);
    if (applied) await this.flushOverrideComments();
    await this.writeSnapshot();
    const { commentId: _, ...stored } = this.overrides.get(record.id) ?? record;
    return { status: applied ? 200 : 409, record: stored };
  }

  async revertOverride(id: string, origin = "cockpit"): Promise<OverrideAnswer> {
    const record = this.overrides.revert(id, `Reverted from the ${origin}; the previous choice is back in force.`);
    if (!record) return { status: 409, error: `${id} is not an applied override` };
    await this.log(record.executionId, `override ${record.id} reverted`);
    await this.flushOverrideComments();
    await this.writeSnapshot();
    const { commentId: _, ...stored } = this.overrides.get(id) ?? { ...record, commentId: "" };
    return { status: 200, record: stored };
  }

  /** Writes each pending override comment once; the stable comment ID makes a retry idempotent. */
  private async flushOverrideComments(): Promise<void> {
    const linear = this.options.linear;
    if (!linear) return;
    for (const record of this.overrides.pendingComments()) {
      try {
        await linear.apply({ kind: "comment", id: record.commentId, issueId: record.issueId, body: overrideComment(record) });
        this.overrides.markComment(record.id, "written");
      } catch (error) {
        this.overrides.markComment(record.id, "failed");
        await this.log(record.executionId, `override ${record.id} comment failed: ${safeMessage(error)}`);
      }
    }
  }

  /** `POST /overrides` and `POST /overrides/<id>/revert`, from local tools only. */
  private handleOverride(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): void {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(`${JSON.stringify(body)}\n`);
    };
    const revert = /^\/overrides\/([A-Za-z0-9_-]{1,64})\/revert$/.exec(request.url ?? "");
    if (request.url !== "/overrides" && !revert) { response.writeHead(404).end(); return; }
    // JSON bodies (which a browser cannot send cross-origin without a preflight
    // this server never answers) and no browser Origin header.
    if (!/^application\/json\b/.test(request.headers["content-type"] ?? "") || request.headers.origin !== undefined) { send(403, { error: "local JSON requests only" }); return; }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; if (body.length > 16_384) request.destroy(); });
    request.on("end", () => {
      void (async () => {
        let input: Record<string, unknown>;
        try { input = JSON.parse(body || "{}") as Record<string, unknown>; } catch { send(400, { error: "invalid JSON" }); return; }
        const origin = typeof input.origin === "string" ? input.origin : "cockpit";
        if (revert) { const answer = await this.revertOverride(revert[1]!, origin); send(answer.status, answer.record ?? { error: answer.error }); return; }
        if (typeof input.executionId !== "string" || typeof input.target !== "string" || typeof input.choice !== "string" || !input.choice.trim()) { send(400, { error: "executionId, target and choice are required" }); return; }
        const answer = await this.override({ executionId: input.executionId, target: input.target, choice: input.choice.trim(), origin, ...(typeof input.decisionId === "string" ? { decisionId: input.decisionId } : {}) });
        send(answer.status, answer.record ?? { error: answer.error });
      })().catch(error => send(500, { error: safeMessage(error) }));
    });
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
      this.remember(claim.assignment.issueId, issue);
      this.store.setIssueMetadata(claim, issue.identifier ?? issue.id, issue.title);
      if (issue.acceptanceCriteria.length === 0) throw new NeedsInputError("Add a # Acceptance section with explicit criteria to the Linear issue, then retry this execution.");
      if (issue.dependencies.some(dependency => dependency.stateType !== 'completed')) throw new NeedsInputError('Complete the blocking dependencies in Linear, then retry this execution.');
      // The configured mapping (linearProject, then linearTeam) names the checkout.
      const repository = repositoryKeyForIssue(issue, this.options.config);
      const route = await this.routeFor(id, issue);
      const previousBranch = this.store.listAssignments().find(assignment => assignment.executionId === id)?.manifest?.branch;
      const manifest: Execution = { id, issueId: issue.id, repository, worktree: "", branch: previousBranch || `kor/${issue.identifier ?? issue.id}`, status: "running", ...(route ? { route } : {}) };
      this.store.markRunning(claim, manifest);
      if (issue.labels.includes('kor:blocked')) this.store.record(claim, [{ kind: 'label', issueId: issue.id, name: 'kor:blocked', present: false }]);
      if (this.options.shipping) {
        const states = workflowMapping(await this.options.linear.listWorkflowStates(issue.teamKey));
        if (!states.review) throw new Error(`Linear team ${issue.teamKey} has no In Review state`);
        const writer = new AgentSessionWriter(this.store, this.options.linear, states);
        writer.start(claim, manifest);
        await writer.flush();
      }
      abort.signal.throwIfAborted();
      if (this.options.runner) result = await this.options.runner({ claim, issue, onSpawn, signal: abort.signal });
      else if (this.options.controller) result = await this.options.controller.dispatch({ ...manifest, status: "queued", issue, claim, onSpawn, signal: abort.signal });
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
    else if (failure !== undefined) {
      if (failure instanceof NeedsInputError) this.store.record(claim, [
        { kind: 'comment', id: stableId('kor-progress', `${id}:needs-input`), issueId: claim.assignment.issueId, body: `Kor needs input for execution ${id}: ${failure.message}` },
        { kind: 'label', issueId: claim.assignment.issueId, name: 'kor:blocked', present: true },
      ]);
      if (failure instanceof ExecutionVerificationError) {
        const manifest = this.store.listAssignments().find(item => item.executionId === id)?.manifest;
        if (manifest) this.store.record(claim, [
          { kind: 'comment', id: stableId('kor-shipping', `${id}:verification-blocked`), issueId: manifest.issueId, body: `Kor verification blocked: ${safeMessage(failure)}\n${failure.findings.map(finding => `${finding.conditionId}: ${finding.status}`).join('\n')}` },
          { kind: 'label', issueId: manifest.issueId, name: 'kor:blocked', present: true },
        ], { ...manifest, status: 'blocked', verification: failure.report });
      }
      this.store.failClaim(claim, failure instanceof NeedsInputError ? `Needs input: ${safeMessage(failure)}` : safeMessage(failure), failure instanceof ExecutionVerificationError || failure instanceof NeedsInputError ? "blocked" : "failed");
    }
    else if (result?.execution.status === "failed" || result?.execution.status === "blocked") this.store.finishClaim(claim, result.execution.status, "execution did not complete", result.execution);
    else if (result && result.execution.status !== "complete") this.store.failClaim(claim, `Unexpected execution outcome: ${result.execution.status}`);
    else if (this.options.shipping) {
      if (!result?.execution.verification?.passed) this.store.failClaim(claim, 'Shipping requires a passing verification report', 'blocked');
      else this.store.finishClaim(claim, 'shipping', undefined, { ...result.execution, status: 'shipping', shipping: { stage: { kind: 'commit' }, evidence: [], cleanup: 'pending' } });
    } else this.store.completeClaim(claim, result?.execution);
    await this.log(id, `execution ${this.store.getAssignment(claim.assignment.issueId).status}${failure ? `: ${safeMessage(failure)}` : ""}`);
  }

  /** An applied override wins; then Jev's preflight (planned once per execution); then the default route. */
  private async routeFor(executionId: string, issue: LinearIssue): Promise<Route | undefined> {
    const defaultRoute = this.options.config.defaultRoute;
    const override = this.overrides.activeRoute(executionId);
    if (override) return { ...defaultRoute, model: override.choice };
    if (this.options.chooseRoute) {
      // The planner replays its durable audit on retry, preserving provider,
      // provenance and decision id instead of reconstructing only a model.
      try { return (await this.options.chooseRoute({ executionId, issue })).route; }
      catch (error) {
        if (error instanceof NeedsInputError) throw error;
        await this.log(executionId, `route preflight unavailable; default route stands: ${safeMessage(error)}`);
        return { ...defaultRoute, label: "fallback" };
      }
    }
    if (this.options.controller) return undefined;
    const planned = [...this.overrides.decisions(executionId)].reverse().find(decision => decision.kind === "route");
    if (planned) return { ...defaultRoute, model: !planned.escalated && planned.choice ? planned.choice : defaultRoute.model, label: planned.escalated ? "fallback" : "jev", decisionId: planned.decisionId };
    return defaultRoute;
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
