import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile, open } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { DecisionRecord, Execution, GatewayAccountHealth, KorRunSnapshot, KorStatusResponse, KorStatusSnapshot, Labelled, OverrideRecord, Route, RouteSource, RunStatus, SessionProcessIdentity } from "@kor-code/core";
import { repositoryKeyForIssue, type KorConfig, type KorPaths } from "@kor-code/config";
import { ExecutionVerificationError, policyTools, type CalibrationBaseline, type Controller } from "@kor-code/controller";
import type { LinearClient, LinearIssue } from "@kor-code/linear";
import { AgentSessionWriter, LinearStore, flushLinearWrites, hasScreenshot, stableId, workflowMapping, type LinearWrite, type AssignmentRecord, type ExecutionClaim } from "@kor-code/linear";
import { captureProcess, processExists, processMatches, stopSession } from "./process.js";
import { OverrideStore } from "./overrides.js";
import type { ShippingDriver } from "./shipping.js";
import type { IssuesResponse, LinearSync, MissionRun, SessionOption, SessionPackResponse, Stage } from "@kor-code/mission-control";
import type { JsonValue } from "@kor-code/core";
import { DEFAULT_SKILL_BUDGET, SESSION_TARGETS, applySkillOverrides, emptySkillPlan, foldSessionEdits, labelEdits, parseSessionEdit, redact, reviewSessionEdit, runtimeSecrets, screenshotReadinessCheck, sessionEditChoice, type SessionEdit, type SessionEditContext, type SkillCandidate, type SkillTier } from "@kor-code/jev";
import { ApiFailure, MissionApi } from "./api.js";
import { MissionEvents } from "./events.js";
import { MissionServices, atomicPrivateFile, live, unavailable } from "./mission-services.js";
import { ensureUiToken } from "./ui-token.js";
export { ensureUiToken } from "./ui-token.js";
export { MissionServices } from "./mission-services.js";
export { GitHubShipping, type ShippingDriver, type ShippingCommand, type DescribePullRequest } from "./shipping.js";

export { OverrideStore } from "./overrides.js";

export { readSnapshot, readStatus, readExecutionStatus } from "./status.js";
export { processMatches } from "./process.js";
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
  gateway?: { accountHealth(): Promise<GatewayAccountHealth[]>; managementAvailable?(): Promise<boolean> };
  /** Models the compatibility probe verified; a route override must name one. */
  verifiedModels?: () => Promise<string[]>;
  /**
   * Plans an execution's route or replays its durable preflight on retry. A thrown
   * error leaves the configured default standing, labelled `fallback`; it never
   * fails the run.
   */
  chooseRoute?: (input: { executionId: string; issue: LinearIssue; previousDecisionId?: string }) => Promise<RouteChoice>;
  /** Built web assets. The CLI defaults to packages/web/dist. */
  webRoot?: string;
  missionServices?: MissionServices;
  probeModel?: (model: string) => Promise<boolean>;
  /** The skill catalogue and a checkout's stack tags, for validating skill, playbook and tool overrides. */
  sessionPolicy?: (repositoryPath: string) => Promise<{ catalogue: { hash: string; skills: SkillCandidate[] }; stackTags: string[] }>;
  /** Rebuild the CLI's controller and preflight with new settings, while idle. */
  reconfigure?: (config: KorConfig) => { controller: Controller; chooseRoute: NonNullable<DaemonOptions["chooseRoute"]> };
}
export interface RouteChoice { route: Route; source: RouteSource }
/** What `POST /overrides` accepts from the cockpit. */
export interface OverrideRequest { executionId: string; target: string; choice: string; decisionId?: string; origin?: string; overBudget?: boolean }
export interface OverrideAnswer { status: number; record?: OverrideRecord; error?: string; tokens?: { before: number; after: number } | null }
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
const LABEL_ORIGIN = "Linear label";
const SKILL_TIERS: readonly SkillTier[] = ["pinned", "listed", "armed", "hidden"];
const SESSION_GRAMMAR: Record<typeof SESSION_TARGETS[number], string> = {
  skills: "Use skill:+NAME, skill:-NAME or skill:NAME=pinned|listed|armed|hidden.",
  playbook: "Use a playbook name or none.",
  tools: "Use tool:+NAME or tool:-NAME.",
};
const tokenCount = (value: number) => value.toLocaleString("en-US");
function overrideComment(record: OverrideRecord): string {
  const verb = record.status === "reverted" ? "reverted" : "applied";
  return [
    `**Kor override ${record.id} ${verb}** from ${record.origin}: \`${record.target}\` → \`${record.choice}\`${record.previous ? ` (was \`${record.previous}\`)` : ""}.`,
    `Execution \`${record.executionId}\`. ${record.reason}`,
    `Policy: ${record.policyChecks.map(check => `${check.name} ${check.result}${check.result === "pass" && check.reason ? ` (${check.reason})` : ""}`).join("; ") || "none"}.`,
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
    ...(manifest?.verification?.costUsd !== undefined ? { costUsd: manifest.verification.costUsd } : {}),
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
  private pollIntervalMs: number;
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
  readonly mission: MissionServices;
  readonly events = new MissionEvents(() => [this.token, ...runtimeSecrets(), ...this.mission.secrets()]);
  private readonly stages = new Map<string, Stage>();
  private readonly shippingActive = new Set<string>();
  private readonly eventSignatures = new Map<string, string>();
  private terminalWrite: Promise<void> = Promise.resolve();
  private quota: Labelled<JsonValue | null> = unavailable(null, "Quota has not been measured");
  private quotaPoll: Promise<Labelled<JsonValue | null>> | undefined;
  private lastQuotaAt = 0;
  private token = "";
  private reconfiguring = false;

  get paths(): KorPaths { return this.options.paths; }
  get config(): KorConfig { return this.options.config; }

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
    this.mission = options.missionServices ?? new MissionServices(options.paths, options.probeModel);
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
      this.token = await ensureUiToken(this.options.paths);
      await this.mission.initialize();
      await this.reconcile();
      const api = new MissionApi(this, this.token, this.options.webRoot);
      const server = createServer((request, response) => {
        const address = server.address();
        const port = address && typeof address !== "string" ? address.port : this.port;
        if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) { response.writeHead(403).end(); return; }
        if ((request.url ?? "").startsWith("/api") || !["/status", "/status/", "/overrides"].includes(request.url ?? "") && !(request.url ?? "").startsWith("/overrides/")) { void api.handle(request, response, port); return; }
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
      const address = server.address();
      if (address && typeof address !== "string") await atomicPrivateFile(join(this.paths.stateDir, "ui-address.json"), `${JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${address.port}/` })}\n`);
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
    await this.terminalWrite;
    this.events.close();
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
      let writeError: unknown;
      if (this.options.linear) {
        try { await flushLinearWrites(this.store, this.options.linear); }
        catch (error) { writeError = error; }
      }
      await this.advanceShipping();
      if (this.now() - this.lastQuotaAt >= 60_000) void this.refreshQuota();
      let found = 0;
      if (this.options.linear) for (const key of teamKeys(this.options.config)) {
        const issues = await this.options.linear.listIssues(key, 100);
        for (const issue of issues) {
          if (this.stopping) break;
          this.remember(issue.id, issue);
          if (issue.stateType !== "unstarted" || !issue.labels.some(label => label.toLowerCase() === this.options.config.intakeLabel.toLowerCase())) continue;
          this.store.enqueue(issue.id, { issueKey: issue.identifier ?? issue.id, issueTitle: issue.title, repository: repositoryKeyForIssue(issue, this.config) });
          found++;
        }
      }
      this.lastPollAt = new Date(this.now()).toISOString();
      if (writeError) await this.reportError(writeError);
      else this.lastError = undefined;
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
      if (previous.shipping.stage.kind === 'closed' || previous.shipping.stage.kind === 'merged' && previous.shipping.cleanup !== 'pending') continue;
      if (!['shipping', 'review', 'blocked', 'complete', 'failed'].includes(assignment.status)) continue;
      this.shippingActive.add(assignment.executionId);
      try {
        const issue = await linear.getIssue(assignment.issueId);
        this.remember(assignment.issueId, issue);
        const repository = this.options.config.repos[previous.repository];
        if (!repository) throw new Error(`Shipping repository missing: ${previous.repository}`);
        const states = workflowMapping(await linear.listWorkflowStates(issue.teamKey));
        if (!states.review) throw new Error(`Linear team ${issue.teamKey} has no In Review state`);
        const writer = new AgentSessionWriter(this.store, linear, states);
        try { await writer.flush(); } catch (error) { await this.reportError(error); }
        let execution = await shipping.advance({ execution: previous, issue, repository });
        const report = execution.shipping;
        if (!report) throw new Error('Shipping driver lost its durable report');
        const changed = previous.shipping.stage.kind !== report.stage.kind || previous.status !== execution.status || previous.shipping.error !== report.error || JSON.stringify(previous.shipping.evidence) !== JSON.stringify(report.evidence);
        const writes: LinearWrite[] = [];
        if (changed) {
          writes.push({ kind: 'label', issueId: issue.id, name: 'kor:blocked', present: execution.status === 'blocked' });
          const stage = report.stage;
          if (stage.kind === 'review' || stage.kind === 'merged') {
            writes.push({ kind: 'attachment', issueId: issue.id, url: stage.url, title: 'GitHub pull request' });
            writes.push({ kind: 'state', issueId: issue.id, stateId: stage.kind === 'merged' ? states.complete.id : states.review.id });
          }
          writes.push({ kind: 'comment', id: stableId('kor-shipping', `${execution.id}:${execution.status}${execution.status === 'blocked' ? `:${report.error ?? ''}` : ''}`), issueId: issue.id,
            body: [`Kor execution ${execution.id}: ${execution.status}`, 'url' in stage ? stage.url : '', report.error ?? '', ...report.evidence.map(item => `${item.kind}: ${item.status} — ${item.summary}`)].filter(Boolean).join('\n') });
        }
        if (changed && (report.stage.kind === 'merged' || report.stage.kind === 'closed')) {
          this.options.controller?.recordTerminalOutcome(execution.id, { status: report.stage.kind === 'merged' ? 'merged' : 'rejected', recordedAt: new Date(this.now()).toISOString(), source: 'shipping.github-observed' });
        }
        this.store.updateShipping(execution, writes);
        try { await writer.flush(); } catch (error) { await this.reportError(error); }
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
      } finally { this.shippingActive.delete(assignment.executionId); }
    }
  }
  async enqueue(issueId: string): Promise<AssignmentRecord> {
    const assignment = this.store.enqueue(issueId);
    await this.writeSnapshot();
    return this.store.listAssignments().find(item => item.issueId === issueId) ?? { ...assignment, attempts: 0 };
  }
  cancel(issueId: string): boolean {
    const assignment = this.store.findAssignment(issueId);
    if (assignment && this.shippingActive.has(assignment.executionId)) return false;
    const accepted = this.store.requestCancel(assignment?.issueId ?? issueId);
    if (accepted) this.active.get(assignment?.issueId ?? issueId)?.abort.abort(new Error("canceled by operator"));
    return accepted;
  }
  retry(issueId: string): boolean { return this.store.retry(issueId); }
  missionRuns(): MissionRun[] {
    const assignments = new Map(this.store.listAssignments().map(assignment => [assignment.executionId, assignment]));
    const historical = this.store.spendHistory();
    const iso = (time: number | undefined) => time === undefined ? null : new Date(time).toISOString();
    return this.status().runs.map(({ verification, ...run }): MissionRun => {
      const assignment = assignments.get(run.executionId);
      const measurements = new Map(historical.filter(metric => metric.executionId === run.executionId).map(({ executionId: _, ...metric }) => [metric.attemptId ?? `legacy-${metric.attempt}`, metric]));
      for (const spend of this.store.spend(run.executionId)) measurements.set(spend.attemptId, spend);
      const spend = [...measurements.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const attempts = verification?.attempts.map(attempt => ({ ...attempt, startedAt: attempt.startedAt ?? null, completedAt: attempt.completedAt ?? null }));
      return { ...run,
        createdAt: iso(assignment?.createdAt), updatedAt: iso(assignment?.updatedAt), startedAt: iso(assignment?.startedAt), completedAt: iso(assignment?.completedAt),
        ...(verification && attempts ? { verification: { ...verification, attempts } } : {}),
        verifiedAt: attempts?.filter(attempt => !attempt.blockers.length && attempt.checks.every(check => check.status === 'pass') && attempt.findings.length > 0 && attempt.findings.every(finding => finding.status === 'pass')).at(-1)?.completedAt ?? null,
        spend: spend.length || run.attempts === 0 ? live(spend) : unavailable([], "No timestamped provider measurements were recorded for this historical execution"),
        ...(spend.length && spend.every(measurement => measurement.costUsd !== null) ? { costUsd: spend.reduce((sum, measurement) => sum + (measurement.costUsd ?? 0), 0) } : {}),
        stage: ["shipping", "review", "complete"].includes(run.status) ? "synchronise" : run.status === "queued" ? "discover" : run.status === "waiting" ? "verify" : this.stages.get(run.executionId) ?? (verification ? "verify" : "preflight"),
        needsInput: run.errorCode === "needs_input" ? { reason: run.error ?? "Operator input required" } : run.status === "waiting" ? { reason: "Verified. Awaiting approval to publish." } : null,
        accountSlot: unavailable(null, "Upstream account binding is not reported by the session"),
      };
    });
  }
  missionRun(reference: string): MissionRun {
    const run = this.missionRuns().find(one => one.executionId === reference || one.issueId === reference || one.issueKey === reference);
    if (!run) throw new ApiFailure(404, "not_found", "Execution not found");
    return run;
  }
  async missionIssues(project: string | null): Promise<IssuesResponse> {
    const repositories = project ? [[project, this.config.repos[project]]] as const : Object.entries(this.config.repos);
    if (project && !this.config.repos[project]) throw new ApiFailure(404, "not_found", "Configured project not found");
    const linear = this.options.linear;
    if (!linear) return { schemaVersion: 1, bounded: true, issues: unavailable([], "Linear connection unavailable") };
    try {
      const issues = (await Promise.all(repositories.map(async ([key, repository]) => {
        const all = await linear.listIssues(repository?.linearTeam ?? key.split("/")[0] ?? key, 100);
        return repository?.linearProject ? all.filter(issue => issue.projectId === repository.linearProject) : all;
      }))).flat();
      return { schemaVersion: 1, bounded: true, issues: { value: [...new Map(issues.map(issue => [issue.id, issue])).values()], provenance: "live", observedAt: new Date().toISOString() } };
    } catch { return { schemaVersion: 1, bounded: true, issues: unavailable([], "Linear issues unavailable") }; }
  }
  async queueIssues(references: string[]): Promise<MissionRun[]> {
    const linear = this.options.linear;
    if (!linear) throw new ApiFailure(503, "unavailable", "Linear connection unavailable");
    const issues = await Promise.all(references.map(reference => linear.getIssue(reference)));
    // Validate the full batch before queueing any of it.
    for (const issue of issues) repositoryKeyForIssue(issue, this.config);
    for (const issue of issues) {
      this.remember(issue.id, issue);
      this.store.enqueue(issue.id, { issueKey: issue.identifier ?? issue.id, issueTitle: issue.title, repository: repositoryKeyForIssue(issue, this.config) });
    }
    await this.writeSnapshot();
    return issues.map(issue => this.missionRun(issue.id));
  }
  async runAction(executionId: string, action: "cancel" | "retry" | "answer" | "approve" | "request-changes" | "note", message?: string, origin: "CLI" | "Mission Control" = "Mission Control"): Promise<LinearSync> {
    const assignment = this.store.findAssignment(executionId);
    if (!assignment) throw new ApiFailure(404, "not_found", "Execution not found");
    if (this.shippingActive.has(executionId)) throw new ApiFailure(409, "conflict", "Publication is advancing; wait for it to settle");
    let accepted = false;
    switch (action) {
      case "cancel": accepted = this.cancel(assignment.issueId); break;
      case "retry":
        if (assignment.status === "blocked" && assignment.manifest?.shipping) { this.store.updateShipping({ ...assignment.manifest, status: "shipping" }); accepted = true; }
        else accepted = this.retry(assignment.issueId);
        break;
      case "approve":
        if (assignment.status === "waiting" && assignment.manifest?.verification?.passed && assignment.manifest.shipping?.stage.kind === "commit") { this.store.updateShipping({ ...assignment.manifest, status: "shipping" }); accepted = true; }
        break;
      case "answer":
        if (assignment.status === "blocked" && this.missionRun(executionId).needsInput && message) { this.store.operatorMessage(executionId, action, message); accepted = this.retry(assignment.issueId); }
        break;
      case "request-changes":
        if (message) { accepted = this.store.requestChanges(executionId); if (accepted) this.store.operatorMessage(executionId, action, message); }
        break;
      case "note":
        if (message && !FINISHED.has(assignment.status)) { this.store.operatorMessage(executionId, action, message); accepted = true; }
        break;
      default: { const exhaustive: never = action; throw new Error(String(exhaustive)); }
    }
    if (!accepted) throw new ApiFailure(409, "conflict", "This action is not available in the execution's current state");
    // The durable action has already applied. Ancillary failures must not ask
    // clients to repeat it; unacknowledged Linear writes retry on the next poll.
    await this.log(executionId, `${action} accepted from ${origin}`).catch(error => this.reportError(error));
    if (this.options.linear) await flushLinearWrites(this.store, this.options.linear).catch(error => this.reportError(error));
    await this.writeSnapshot().catch(error => this.reportError(error));
    const { pendingWrites } = this.store.counts();
    return pendingWrites ? { status: "pending", pendingWrites } : { status: "synced" };
  }
  async configure(config: KorConfig): Promise<void> {
    if (this.active.size || this.poll || this.shippingActive.size) throw new ApiFailure(409, "conflict", "Wait for running work and polling to settle before changing configuration");
    this.reconfiguring = true;
    try {
    const runtime = this.options.reconfigure?.(config);
    if (!runtime && this.options.controller) throw new ApiFailure(409, "conflict", "This daemon cannot reload its controller");
    const previous = await readFile(this.paths.configFile, "utf8").catch(error => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (previous !== undefined) await atomicPrivateFile(`${this.paths.configFile}.bak`, previous);
    await atomicPrivateFile(this.paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
    this.options.config = config;
    this.pollIntervalMs = config.pollIntervalSeconds * 1000;
    if (runtime) { this.options.controller = runtime.controller; this.options.chooseRoute = runtime.chooseRoute; }
    await this.writeSnapshot();
    } finally { this.reconfiguring = false; }
  }
  async connectionsChanged(provider: string): Promise<void> {
    if (provider === "linear") this.options.linear = this.mission.linear();
    if (provider === "gateway") {
      this.options.gateway = await this.mission.gateway();
      // Observations from another gateway must not survive a connection switch.
      this.accounts = undefined;
      await this.quotaPoll?.catch(() => undefined);
      this.quota = unavailable(null, "Gateway connection changed; quota has not been observed");
      this.lastQuotaAt = 0;
      await this.refreshAccounts();
    }
  }
  refreshQuota(): Promise<Labelled<JsonValue | null>> {
    if (this.quotaPoll) return this.quotaPoll;
    if (this.now() - this.lastQuotaAt < 60_000) return Promise.resolve(this.quota);
    this.lastQuotaAt = this.now();
    this.quotaPoll = this.mission.quota().then(quota => { this.quota = quota; this.events.publish({ kind: "usage", quota }); return quota; }).finally(() => { this.quotaPoll = undefined; });
    return this.quotaPoll;
  }
  setStage(executionId: string, stage: Stage): void {
    this.stages.set(executionId, stage);
    this.events.publish({ kind: "stage", executionId, stage });
  }
  /** Labels a sampled calibration baseline in the run's own stream, so its extra session is not mistaken for the run. */
  recordBaseline(executionId: string, baseline: CalibrationBaseline): void {
    const arm = baseline.purpose === "skills" ? "the same route without skills, to measure skill lift" : "the baseline route, to measure Jev's routing";
    const message = baseline.status === "started"
      ? `calibration baseline started on ${baseline.model}: ${arm}. It never ships and does not change this run.`
      : `calibration baseline ${baseline.status}${baseline.costUsd === undefined ? "" : ` · $${baseline.costUsd.toFixed(4)}`}. This run's result is unchanged.`;
    void this.log(executionId, message).catch(error => this.reportError(error));
  }
  recordOutput(executionId: string, channel: "stdout" | "stderr" | "daemon", text: string): void {
    const safe = redact(text, [this.token, ...runtimeSecrets(), ...this.mission.secrets()]);
    if (typeof safe !== "string") return;
    for (let index = 0; index < safe.length; index += 16_000) {
      const chunk = safe.slice(index, index + 16_000);
      this.terminalWrite = this.terminalWrite.then(async () => {
        const file = join(this.paths.logsDir, `${basename(executionId)}.terminal.log`);
        await appendFile(file, chunk, { mode: 0o600 });
        this.events.publish({ kind: "terminal", executionId, channel, text: chunk, offset: (await stat(file)).size });
      }).catch(error => this.reportError(error));
    }
  }
  async readTerminal(executionId: string): Promise<{ content: string; offset: number }> {
    this.missionRun(executionId);
    await this.terminalWrite;
    const tail = async (file: string) => {
      const handle = await open(file, "r");
      try {
        const offset = (await handle.stat()).size;
        const length = Math.min(offset, 1_048_576);
        const buffer = Buffer.alloc(length);
        const result = await handle.read(buffer, 0, length, offset - length);
        const text = buffer.subarray(0, result.bytesRead).toString("utf8");
        return { content: offset > length ? text.slice(text.indexOf("\n") + 1) : text, offset };
      } finally { await handle.close(); }
    };
    try { return await tail(join(this.paths.logsDir, `${basename(executionId)}.terminal.log`)); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return tail(join(this.paths.logsDir, `${basename(executionId)}.log`)).catch(() => ({ content: "", offset: 0 })); throw error; }
  }
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
      if (this.options.gateway.managementAvailable && !await this.options.gateway.managementAvailable()) throw new Error("Gateway management data unavailable");
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
    const session = SESSION_TARGETS.find(kind => kind === request.target || kind === decision?.kind);
    const checks: OverrideRecord["policyChecks"] = [{ name: "execution not finished", result: FINISHED.has(run.status) ? "fail" : "pass" }];
    let previous: string | undefined;
    let tokens: OverrideAnswer["tokens"];
    let overBudget = false;
    if (session) {
      const edit = parseSessionEdit(session, request.choice);
      checks.push({ name: `valid ${session} edit`, result: edit ? "pass" : "fail", ...(edit ? {} : { reason: SESSION_GRAMMAR[session] }) });
      if (edit) {
        try {
          const review = reviewSessionEdit(edit, { ...await this.sessionContext(run.executionId, run.repository), ...(request.overBudget ? { overBudget: true } : {}) });
          checks.push(...review.checks);
          overBudget = review.needsConfirmation;
          tokens = review.tokens;
          previous = review.previous;
        } catch (error) { checks.push({ name: "skill catalogue available", result: "fail", reason: safeMessage(error) }); }
      }
    } else if (isRoute) {
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
    const failed = checks.filter(check => check.result === "fail").map(check => check.reason ? `${check.name} (${check.reason})` : check.name);
    const applied = failed.length === 0;
    const guidance = tokens ? ` Estimated guidance with the current plan goes from ${tokenCount(tokens.before)} to ${tokenCount(tokens.after)} tokens per turn; Jev replans at session start.` : "";
    const record = this.overrides.record({
      executionId: run.executionId,
      issueId: run.issueId,
      target: session ?? (isRoute ? "route" : decision?.decisionId ?? request.target),
      choice: request.choice,
      ...(previous ? { previous } : {}),
      ...(applied && overBudget ? { overBudget: true as const } : {}),
      status: applied ? "applied" : "rejected",
      reason: applied ? (session ? `Applies from the next session; the running session keeps its pack.${guidance}` : isRoute ? "Applies from the next attempt; the running session keeps its model." : "Recorded against the decision for the next evaluation.") : `Policy refused it: ${failed.join(", ")}.`,
      policyChecks: checks,
      origin: (request.origin ?? "cockpit").slice(0, 40),
    });
    await this.log(run.executionId, `override ${record.id} ${record.status}: ${record.target} -> ${record.choice} (${record.reason})`);
    if (applied) await this.flushOverrideComments();
    await this.writeSnapshot();
    const { commentId: _, ...stored } = this.overrides.get(record.id) ?? record;
    return { status: applied ? 200 : 409, record: stored, ...(tokens !== undefined ? { tokens } : {}) };
  }

  /** The skill catalogue sessions plan from; empty while no repository is configured. */
  async skillCatalogue(): Promise<readonly SkillCandidate[]> {
    const repository = Object.values(this.config.repos)[0];
    if (!repository || !this.options.sessionPolicy) return [];
    return (await this.options.sessionPolicy(repository.path)).catalogue.skills;
  }

  /** Skill names in repository settings that the catalogue does not hold; a session would refuse them. */
  async unknownRepositorySkills(config: KorConfig): Promise<string[]> {
    const policy = this.options.sessionPolicy;
    const unknown = new Set<string>();
    for (const repository of Object.values(config.repos)) {
      const names = [...repository.skills?.always ?? [], ...repository.skills?.pins ?? [], ...repository.skills?.never ?? []];
      if (!policy || !names.length) continue;
      const { catalogue } = await policy(repository.path);
      for (const name of names) if (!catalogue.skills.some(skill => skill.name === name)) unknown.add(name);
    }
    return [...unknown].sort();
  }

  /** Skill, playbook and tool edits in force for an execution, oldest first; the controller reads them before every session. */
  sessionEdits(executionId: string): SessionEdit[] {
    return this.overrides.sessionOverrides(executionId).filter(record => record.status === "applied").flatMap(record => {
      const edit = parseSessionEdit(record.target, record.choice);
      return !edit ? [] : edit.target === "skills" && record.overBudget ? [{ ...edit, overBudget: true }] : [edit];
    });
  }

  private async sessionContext(executionId: string, repositoryKey: string | undefined): Promise<SessionEditContext> {
    const repository = repositoryKey ? this.config.repos[repositoryKey] : undefined;
    if (!repository) throw new Error("The execution's repository is not known yet");
    if (!this.options.sessionPolicy) throw new Error("The skill catalogue is not available to this daemon");
    const { catalogue, stackTags } = await this.options.sessionPolicy(repository.path);
    const eligibleTools = policyTools({ allowedTools: repository.toolAllowlist, checks: repository.checks, ...(repository.tools ? { tools: repository.tools } : {}) });
    const planned = this.overrides.sessionPlan(executionId);
    const budget = repository.skills?.budget ?? DEFAULT_SKILL_BUDGET;
    return {
      skills: catalogue.skills,
      plan: planned.skills ? { ...planned.skills, budget } : emptySkillPlan(catalogue, budget),
      overrides: foldSessionEdits(this.sessionEdits(executionId)),
      policy: { stage: "execute", allowedTools: eligibleTools, stackTags, ...repository.skills,
        ...(this.config.skills ? { bodyBudget: this.config.skills.bodyBudget } : {}) },
      playbook: planned.playbook ?? null,
      eligibleTools,
    };
  }

  /** The next session's guidance with overrides applied, and what each possible edit would cost or why policy refuses it. */
  async sessionPack(executionId: string): Promise<SessionPackResponse> {
    const run = this.missionRun(executionId);
    let context: SessionEditContext;
    try { context = await this.sessionContext(run.executionId, run.repository); }
    catch (error) { throw new ApiFailure(409, "conflict", safeMessage(error), "Start the run once, or check the repository mapping and kor skills doctor"); }
    const option = (edit: SessionEdit): SessionOption => {
      const review = reviewSessionEdit(edit, { ...context, overBudget: true });
      const failed = review.checks.find(check => check.result === "fail");
      return { choice: sessionEditChoice(edit), tokenDelta: review.tokens ? review.tokens.after - review.tokens.before : null,
        overBudget: review.needsConfirmation,
        blocked: failed ? failed.reason ?? failed.name : null };
    };
    const effective = applySkillOverrides(context.plan, context.skills, context.overrides, context.policy);
    const kinds = new Map(context.skills.map(skill => [skill.name, skill.kind]));
    const playbook = context.overrides.playbook ?? context.playbook ?? "none";
    return {
      schemaVersion: 1, executionId: run.executionId, planned: this.overrides.sessionPlan(run.executionId).skills !== undefined,
      budget: context.plan.budget, tokens: effective.tokens,
      skills: effective.skills.filter(entry => kinds.get(entry.name) !== "playbook").map(entry => ({
        name: entry.name, tier: entry.tier, jevTier: context.plan.skills.find(planned => planned.name === entry.name)?.tier ?? "hidden",
        probability: entry.probability, tokens: entry.tokens, reason: entry.reason,
        options: SKILL_TIERS.filter(tier => tier !== entry.tier).map(tier => option({ target: "skills", name: entry.name, tier })),
      })),
      playbook: { selected: playbook === "none" ? null : playbook, jev: context.playbook,
        options: ["none", ...context.skills.filter(skill => skill.kind === "playbook").map(skill => skill.name)].filter(name => name !== playbook).map(name => option({ target: "playbook", name })) },
      tools: { eligible: [...context.eligibleTools], overrides: [...context.overrides.tools].map(([name, present]) => ({ name, present })),
        options: context.eligibleTools.flatMap(name => [true, false].filter(present => context.overrides.tools.get(name) !== present).map(present => option({ target: "tools", name, present }))) },
    };
  }

  /**
   * Records each `kor:skill/…`, `kor:playbook/…` and `kor:tool/…` label on the issue as an
   * override, and reverts one whose label was removed. A refused label is judged again at the
   * next execution start, since the catalogue or repository policy may have changed.
   */
  private async syncLabelOverrides(executionId: string, labels: readonly string[]): Promise<void> {
    const wanted = labelEdits(labels).map(edit => ({ target: edit.target, choice: sessionEditChoice(edit) }));
    const recorded = this.overrides.sessionOverrides(executionId).filter(record => record.origin === LABEL_ORIGIN);
    for (const record of recorded) {
      if (record.status === "applied" && !wanted.some(edit => edit.target === record.target && edit.choice === record.choice)) await this.revertOverride(record.id, `${LABEL_ORIGIN} (removed)`);
    }
    for (const edit of wanted) {
      if (!recorded.some(record => record.status === "applied" && record.target === edit.target && record.choice === edit.choice)) await this.override({ executionId, ...edit, origin: LABEL_ORIGIN });
    }
  }

  async revertOverride(id: string, origin = "cockpit"): Promise<OverrideAnswer> {
    const record = this.overrides.revert(id, `Reverted from ${origin}; the previous choice is back in force.`);
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
        const answer = await this.override({ executionId: input.executionId, target: input.target, choice: input.choice.trim(), origin, ...(typeof input.decisionId === "string" ? { decisionId: input.decisionId } : {}), ...(input.overBudget === true ? { overBudget: true } : {}) });
        send(answer.status, answer.record ?? { error: answer.error });
      })().catch(error => send(500, { error: safeMessage(error) }));
    });
  }
  response(): KorStatusResponse { const snapshot = this.status(); return { schemaVersion: 1, provenance: "live", observedAt: snapshot.observedAt, snapshot }; }

  private busy = false;
  private tick(): Promise<void> {
    if (this.busy || this.stopping || this.reconfiguring) return this.cycle;
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
      this.setStage(id, "supervise");
      const captured = { ...captureProcess(pid), executionId: id };
      identity = captured;
      this.store.setSessionPid(claim, pid, captured);
      abort.signal.throwIfAborted();
    };
    try {
      await this.log(id, "execution started");
      if (!this.options.linear) throw new Error("Linear client unavailable");
      const issue = await this.options.linear.getIssue(claim.assignment.issueId);
      this.setStage(id, "discover");
      const messages = this.store.operatorMessages(id);
      const answers = messages.filter(message => message.kind === "answer");
      const answer = answers.at(-1);
      if (issue.acceptanceCriteria.length === 0 && answer) issue.acceptanceCriteria = [answer.message];
      if (messages.length) issue.description = `${issue.description ?? ""}\n\nOperator guidance:\n${messages.map(message => `${message.kind}: ${message.message}`).join("\n\n")}`;
      this.remember(claim.assignment.issueId, issue);
      this.store.setIssueMetadata(claim, issue.identifier ?? issue.id, issue.title);
      if (issue.acceptanceCriteria.length === 0) throw new NeedsInputError("Add a # Acceptance section with explicit criteria to the Linear issue, then retry this execution.");
      if (issue.dependencies.some(dependency => dependency.stateType !== 'completed')) throw new NeedsInputError('Complete the blocking dependencies in Linear, then retry this execution.');
      // The configured mapping (linearProject, then linearTeam) names the checkout.
      const repository = repositoryKeyForIssue(issue, this.options.config);
      this.setStage(id, "preflight");
      const screenshotCheck = screenshotReadinessCheck({ labels: issue.labels, hasScreenshot: hasScreenshot(issue) });
      if (screenshotCheck.result === "fail") throw new NeedsInputError(screenshotCheck.reason);
      const route = await this.routeFor(id, issue);
      const previous = this.store.listAssignments().find(assignment => assignment.executionId === id)?.manifest;
      const manifest: Execution = { ...(previous?.verification ? { verification: { ...previous.verification, passed: false } } : {}), id, issueId: issue.id, repository, worktree: previous?.worktree ?? "", branch: previous?.branch || `kor/${issue.identifier ?? issue.id}`, status: "running", ...(route ? { route } : {}) };
      this.store.markRunning(claim, manifest);
      await this.syncLabelOverrides(id, issue.labels);
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
      this.failExecution(claim, `session cleanup failed: ${safeMessage(cleanupFailure)}`);
    } else if (this.store.isCancelRequested(claim.assignment.issueId)) this.store.cancelClaim(claim);
    else if (this.stopping) this.store.recover(claim.assignment.issueId, "daemon stopped; session stopped; re-queued");
    else if (failure !== undefined) {
      if (failure instanceof NeedsInputError) this.store.record(claim, [
        { kind: 'comment', id: stableId('kor-progress', `${id}:needs-input:${failure.message}`), issueId: claim.assignment.issueId, body: `Kor needs input for execution ${id}: ${failure.message}` },
        { kind: 'label', issueId: claim.assignment.issueId, name: 'kor:blocked', present: true },
      ]);
      if (failure instanceof ExecutionVerificationError) {
        const manifest = this.store.listAssignments().find(item => item.executionId === id)?.manifest;
        if (manifest) this.store.record(claim, [
          { kind: 'comment', id: stableId('kor-shipping', `${id}:verification-blocked:${JSON.stringify(failure.report)}`), issueId: manifest.issueId, body: `Kor verification blocked: ${safeMessage(failure)}\n${failure.findings.map(finding => `${finding.conditionId}: ${finding.status}`).join('\n')}` },
          { kind: 'label', issueId: manifest.issueId, name: 'kor:blocked', present: true },
        ], { ...manifest, status: 'blocked', verification: failure.report });
      }
      if (failure instanceof NeedsInputError || failure instanceof ExecutionVerificationError) this.store.failClaim(claim, failure instanceof NeedsInputError ? `Needs input: ${safeMessage(failure)}` : safeMessage(failure), "blocked");
      else this.failExecution(claim, safeMessage(failure));
    }
    else if (result?.execution.status === "failed" || result?.execution.status === "blocked") this.failExecution(claim, "execution did not complete", result.execution);
    else if (result && result.execution.status !== "complete") this.failExecution(claim, `Unexpected execution outcome: ${result.execution.status}`);
    else if (this.options.shipping) {
      if (!result?.execution.verification?.passed) this.store.failClaim(claim, 'Shipping requires a passing verification report', 'blocked');
      else {
        const gated = this.options.config.repos[result.execution.repository]?.ship === "approve";
        const latest = result.execution.verification.attempts.at(-1);
        const writes: LinearWrite[] = gated ? [{ kind: 'comment', id: stableId('kor-progress', `${id}:verified:${latest?.attemptId ?? latest?.attempt ?? 0}`), issueId: result.execution.issueId,
          body: [`Kor execution ${id} verified and is waiting for approval to publish.`,
            ...(latest?.checks.map(check => `${check.command}: ${check.status} (exit ${check.exitCode})`) ?? []),
            ...(latest?.findings.map(finding => `${finding.conditionId}: ${finding.status}`) ?? []),
            'Review the recorded evidence, then approve and ship in Mission Control.',
          ].join('\n') }] : [];
        this.store.finishClaim(claim, gated ? 'waiting' : 'shipping', undefined, { ...result.execution, status: gated ? 'waiting' : 'shipping', shipping: { stage: { kind: 'commit' }, evidence: [], cleanup: 'pending' } }, writes);
      }
    } else this.store.completeClaim(claim, result?.execution);
    await this.log(id, `execution ${this.store.getAssignment(claim.assignment.issueId).status}${failure ? `: ${safeMessage(failure)}` : ""}`);
  }

  private failExecution(claim: ExecutionClaim, reason: string, execution?: Execution): void {
    this.store.finishClaim(claim, execution?.status === "blocked" ? "blocked" : "failed", reason, execution, [
      { kind: 'comment', id: stableId('kor-progress', `${claim.assignment.executionId}:failed:${claim.token}`), issueId: claim.assignment.issueId,
        body: `Kor execution failed: ${reason}\nResolve the blocker, then Retry from Home or the run in Mission Control.` },
      { kind: 'label', issueId: claim.assignment.issueId, name: 'kor:blocked', present: true },
    ]);
  }

  /** An applied override wins; then Jev's preflight (planned once per execution); then the default route. */
  private async routeFor(executionId: string, issue: LinearIssue): Promise<Route | undefined> {
    const defaultRoute = this.options.config.defaultRoute;
    const override = this.overrides.activeRoute(executionId);
    if (override) return { ...defaultRoute, model: override.choice, label: "override", decisionId: override.id };
    if (this.options.chooseRoute) {
      // The planner replays its durable audit on retry, preserving provider,
      // provenance and decision id instead of reconstructing only a model.
      const previousDecisionId = this.store.findAssignment(executionId)?.manifest?.route?.decisionId;
      try { return (await this.options.chooseRoute({ executionId, issue, ...(previousDecisionId ? { previousDecisionId } : {}) })).route; }
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
      for (const run of this.missionRuns()) {
        const signature = JSON.stringify({ ...run, observedAt: undefined, heartbeatAt: undefined, accountSlot: { ...run.accountSlot, observedAt: undefined }, spend: { ...run.spend, observedAt: undefined } });
        if (this.eventSignatures.get(run.executionId) !== signature) {
          const previous = this.eventSignatures.get(run.executionId);
          this.eventSignatures.set(run.executionId, signature);
          this.events.publish({ kind: "run", run });
          if (run.needsInput || previous?.includes('"needsInput":{')) this.events.publish({ kind: "needs-input", executionId: run.executionId, reason: run.needsInput?.reason ?? null });
        }
      }
      for (const decision of snapshot.decisions?.value ?? []) {
        const key = `decision:${decision.decisionId}`;
        const signature = JSON.stringify(decision);
        if (this.eventSignatures.get(key) !== signature) { this.eventSignatures.set(key, signature); this.events.publish({ kind: "decision", decision }); }
      }
      if (snapshot.accounts) {
        const signature = JSON.stringify({ ...snapshot.accounts, observedAt: undefined });
        if (this.eventSignatures.get("pool") !== signature) { this.eventSignatures.set("pool", signature); this.events.publish({ kind: "pool", accounts: snapshot.accounts }); }
      }
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
    if (id !== "daemon") this.recordOutput(id, "daemon", `${new Date(this.now()).toISOString()} ${message}\n`);
  }
  async readLog(id: string): Promise<string> {
    try { return await readFile(join(this.options.paths.logsDir, `${basename(id)}.log`), "utf8"); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""; throw error; }
  }
}
export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> { return new KorDaemon(options).start(); }
