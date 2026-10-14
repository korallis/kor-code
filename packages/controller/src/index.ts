import type { CatalogueModel, Evidence, Execution, Route } from "@kor-code/core";
import { JevDecisionCore, routeFromDecision } from "@kor-code/jev";
import type { LinearClient, LinearIssue, WorkflowMapping, ExecutionClaim } from "@kor-code/linear";
import { AgentSessionWriter, DurableQueue, ExecutionLease, LinearStore, SnapshotReader } from "@kor-code/linear";
import { randomUUID } from "node:crypto";
import { RepositoryRegistry, type RepositoryLookup, type Repository } from "./repository.js";
import { type Worktree, type WorktreeManager } from "./worktree.js";
import { ConcurrencyLimiter } from "./limiter.js";
import { type SessionResult, type SessionLauncherLike } from "./launcher.js";
import { RestartReconciler, type ReconciliationReport } from "./reconcile.js";
import { VerificationError, VerificationTracker } from "@kor-code/verification";
import { CalibrationStore, sampledPair, type CalibrationRun, type RunOutcome } from "@kor-code/calibration";
import { ExecutionVerificationError, verificationBase, verificationSettings, type VerificationOptions } from "./verification.js";

import { runVerifiedSessions } from "./attempts.js";

export * from "./repository.js";
export * from "./worktree.js";
export * from "./limiter.js";
export * from "./events.js";
export * from "./launcher.js";
export * from "./reconcile.js";
export * from "./verification.js";

export interface ControllerLinearRuntime { store: LinearStore; client: LinearClient; workflow: WorkflowMapping }
export type VerificationFactory = (execution: Execution) => VerificationTracker;
export interface ControllerOptions {
  repositories: RepositoryLookup;
  worktrees: WorktreeManager;
  launcher: SessionLauncherLike;
  linear?: ControllerLinearRuntime;
  jev?: JevDecisionCore;
  catalogue?: readonly CatalogueModel[];
  limits?: ConcurrencyLimiter;
  owner?: string;
  defaultRoute?: Route;
  promptPrefix?: string;
  leaseTtlMs?: number;
  verification?: VerificationFactory;
  verificationOptions?: VerificationOptions;
  calibration?: { store: CalibrationStore; sampleRate?: number; baselineRoute?: Route };
}
export interface ControllerRunResult {
  execution: Execution;
  issue: LinearIssue;
  repository: Repository;
  worktree: Worktree;
  session: SessionResult;
  claim?: ExecutionClaim;
}
export interface Controller {
  dispatch(execution: Execution & { issue?: LinearIssue; prompt?: string; claim?: ExecutionClaim; evidence?: Evidence[]; onSpawn?: (pid: number) => void }): Promise<ControllerRunResult>;
  runIssue(issueId: string, evidence?: Evidence[]): Promise<ControllerRunResult>;
  runNext(): Promise<ControllerRunResult | undefined>;
  reconcile(): Promise<ReconciliationReport>;
  recordTerminalOutcome(executionId: string, outcome: RunOutcome): void;
}

function acceptance(issue: LinearIssue) { return issue.acceptanceCriteria.map((description, index) => ({ id: `acceptance-${index + 1}`, description, required: true })); }
function promptFor(issue: LinearIssue, prefix = ""): string {
  const criteria = issue.acceptanceCriteria.length > 0 ? issue.acceptanceCriteria.map(item => `- ${item}`).join("\n") : "- No explicit acceptance criteria were supplied.";
  return `${prefix}Linear issue ${issue.id}: ${issue.title}\n\n${issue.description ?? ""}\n\nAcceptance criteria:\n${criteria}`.trim();
}
interface ChosenRoute { route?: Route; decisionId?: string }
async function chooseRoute(options: ControllerOptions, executionId: string, issue: LinearIssue, existing?: Route): Promise<ChosenRoute> {
  if (existing) return { route: existing };
  const catalogue = options.catalogue ?? [];
  if (!options.jev || catalogue.length === 0) return { ...(options.defaultRoute ? { route: options.defaultRoute } : {}) };
  const candidates = catalogue.filter(item => item.available !== false).map(item => item.model);
  if (candidates.length === 0) throw new Error("No available model routes in catalogue");
  const decision = await options.jev.selectRoute({ decisionId: `route-${executionId}`, executionId, kind: "route", question: "Select the available model route that best fits this Linear issue and its acceptance conditions.", state: { issueId: issue.id, title: issue.title, description: issue.description ?? "", acceptance: issue.acceptanceCriteria, dependencies: issue.dependencies }, inputs: [{ name: "issue", value: issue.title, source: "linear" }], candidates, policyChecks: [{ name: "catalogue-nonempty", result: "pass" }] });
  if (decision.escalated) throw new Error(`Jev escalated route selection for ${executionId}`);
  return { route: routeFromDecision(decision, catalogue, { accountPolicy: "fill-first", sessionAffinity: true }), decisionId: decision.decisionId };
}

class ExecutionController implements Controller {
  private readonly limiter: ConcurrencyLimiter;
  private readonly owner: string;
  private readonly queue?: DurableQueue;
  private readonly lease?: ExecutionLease;
  private readonly writer?: AgentSessionWriter;
  private readonly snapshots?: SnapshotReader;
  private readonly reconciler?: RestartReconciler;
  private readonly leaseTtlMs: number;
  constructor(private readonly options: ControllerOptions) {
    this.limiter = options.limits ?? new ConcurrencyLimiter({ total: 1 });
    this.leaseTtlMs = options.leaseTtlMs ?? 60_000;
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs <= 0) throw new Error("Lease TTL must be positive");
    this.owner = options.owner ?? `controller-${process.pid}-${randomUUID()}`;
    if (options.linear) {
      this.queue = new DurableQueue(options.linear.store);
      this.lease = new ExecutionLease(options.linear.store);
      this.writer = new AgentSessionWriter(options.linear.store, options.linear.client, options.linear.workflow);
      this.snapshots = new SnapshotReader(options.linear.client);
      this.reconciler = new RestartReconciler(options.linear.store, options.worktrees);
    }
  }
  async dispatch(input: Execution & { issue?: LinearIssue; prompt?: string; claim?: ExecutionClaim; evidence?: Evidence[]; onSpawn?: (pid: number) => void }): Promise<ControllerRunResult> {
    const issue = input.issue ?? (this.snapshots ? (await this.snapshots.read(input.issueId)).issue : undefined);
    if (!issue) throw new Error("Controller dispatch requires an issue or a Linear runtime");
    const repository = await this.options.repositories.resolve(input.repository);
    const chosen = await chooseRoute(this.options, input.id, issue, input.route);
    const route = chosen.route;
    const decisionId = chosen.decisionId;
    const permit = await this.limiter.acquire({ repository: repository.key, ...(route?.provider ? { provider: route.provider } : {}) });
    let worktree: Worktree | undefined;
    let claim: ExecutionClaim | undefined;
    let heartbeat: { failed: Promise<never>; stop: () => void } | undefined;
    try {
      if (this.lease && this.writer) {
        claim = input.claim ?? this.lease.claim(this.owner, this.leaseTtlMs, input.issueId);
        if (!claim) throw new Error(`No execution lease available for ${input.issueId}`);
      }
      worktree = await this.options.worktrees.create({ executionId: input.id, issueId: input.issueId, repository, branch: input.branch });
      const execution: Execution = { ...input, repository: repository.key, worktree: worktree.path, branch: worktree.branch, status: "running", ...(route ? { route } : {}), manifest: { executionId: input.id, issueId: input.issueId, repository: repository.key, worktree: worktree.path, branch: worktree.branch, agents: [], acceptance: acceptance(issue) } };
      const verification = this.options.verification?.(execution) ?? (this.writer ? new VerificationTracker(execution.manifest?.acceptance ?? [], execution.id) : undefined);
      const calibrationRoute = route ?? this.options.calibration?.baselineRoute;
      if (this.lease && this.writer) {
        if (!claim) throw new Error(`No execution lease available for ${input.issueId}`);
        this.writer.start(claim, execution);
        await this.writer.flush();
      }
      const baseRevision = this.options.calibration?.store.run(input.id)?.baseRevision ?? await verificationBase(worktree.path);
      const calibrationStartedAt = new Date().toISOString();
      if (this.options.calibration && calibrationRoute) {
        const arm = !input.route && this.options.jev && (this.options.catalogue?.length ?? 0) > 0 ? "jev" : "fallback";
        this.options.calibration.store.beginRun({ executionId: input.id, pairId: input.id, issueId: input.issueId, arm, baseRevision, route: calibrationRoute, sampled: arm === "jev" && sampledPair(input.id, this.options.calibration.sampleRate ?? 0.25), startedAt: calibrationStartedAt, status: "running" });
      }
      const initialPrompt = input.prompt ?? promptFor(issue, this.options.promptPrefix);
      const settings = verificationSettings(this.options.verificationOptions);
      heartbeat = claim && this.lease ? this.startHeartbeat(claim) : undefined;
      const { session, latest, verificationReport } = await runVerifiedSessions({ execution, repository, initialPrompt, baseRevision,
        launcher: this.options.launcher, settings, ...(this.options.jev ? { jev: this.options.jev } : {}),
        ...(this.options.calibration && calibrationRoute ? { calibration: this.options.calibration.store } : {}),
        ...(decisionId ? { decisionId } : {}),
        ...(heartbeat ? { leaseFailure: heartbeat.failed } : {}), ...(input.onSpawn ? { onSpawn: input.onSpawn } : {}) });
      const completedExecution = { ...execution, status: "complete" as const, verification: verificationReport };
      if (this.writer && claim) {
        try {
          verification?.addMany(input.evidence ?? []);
          verification?.addMany(latest.evidence);
          if (latest.blockers.length > 0) throw new VerificationError(latest.blockers.join("; "), latest.findings);
          verification?.assertComplete();
        } catch (error) {
          const failure = error instanceof VerificationError
            ? error
            : new VerificationError(error instanceof Error ? error.message : String(error), verification?.findings() ?? latest.findings);
          await this.writer.recordVerificationBlock(claim, { ...execution, status: "blocked", verification: verificationReport }, failure.findings, latest.blockers);
          await this.writer.flush();
          this.finishCalibration(input.id, "failed", "controller.verification-block");
          throw failure;
        }
        await this.writer.complete(claim, { summary: `Execution ${input.id} completed`, evidence: verification?.evidence() ?? [] });
        await this.writer.flush();
      }
      if (latest.blockers.length > 0) {
        this.finishCalibration(input.id, "failed", "controller.verification-block");
        throw new ExecutionVerificationError(verificationReport);
      }
      this.finishCalibration(input.id, "verified", "controller.completed");
      if (this.options.calibration && calibrationRoute && this.options.calibration.store.run(input.id)?.arm === "jev" && this.options.calibration.store.run(input.id)?.sampled) {
        // The primary outcome is durable before a baseline replay begins. The
        // replay is a comparison arm and cannot hold up the real Linear write.
        await this.runBaseline({ execution, issue, repository, baseRevision, initialPrompt, settings, calibration: this.options.calibration, ...(input.onSpawn ? { onSpawn: input.onSpawn } : {}) });
      }
      return { execution: completedExecution, issue, repository, worktree, session, ...(claim ? { claim } : {}) };
    } catch (error) {
      const run = this.options.calibration?.store.run(input.id);
      if (run?.status === "running") this.finishCalibration(input.id, error instanceof ExecutionVerificationError || error instanceof VerificationError ? "failed" : error instanceof Error && /Jev escalated route selection/.test(error.message) ? "escalated" : "interrupted", error instanceof ExecutionVerificationError || error instanceof VerificationError ? "controller.verification-block" : error instanceof Error && /Jev escalated route selection/.test(error.message) ? "controller.escalated" : "controller.abandoned");
      if (claim && this.options.linear) {
        try { this.options.linear.store.release(claim, 1_000); } catch { /* expired claims are reclaimed on restart */ }
      }
      throw error;
    } finally {
      heartbeat?.stop();
      permit.release();
    }
  }
  private finishCalibration(executionId: string, status: Exclude<CalibrationRun["status"], "running">, source: string): void {
    const calibration = this.options.calibration;
    const run = calibration?.store.run(executionId);
    if (!calibration || !run || run.status !== "running") return;
    calibration.store.finishRun(executionId, status);
    if (status !== "verified") this.recordTerminalOutcome(executionId, { status: status === "failed" ? "rejected" : status === "escalated" ? "escalated" : "abandoned", recordedAt: new Date().toISOString(), source });
  }
  recordTerminalOutcome(executionId: string, outcome: RunOutcome): void {
    const calibration = this.options.calibration;
    const run = calibration?.store.run(executionId);
    if (!calibration || !run || calibration.store.outcomes().some(item => item.executionId === executionId)) return;
    if (run.status === "running") calibration.store.finishRun(executionId, outcome.status === "merged" ? "verified" : outcome.status === "rejected" ? "failed" : outcome.status === "escalated" ? "escalated" : "interrupted");
    calibration.store.recordExecutionOutcome(executionId, outcome, this.options.jev);
  }
  private async runBaseline(input: { execution: Execution; issue: LinearIssue; repository: Repository; baseRevision: string; initialPrompt: string; settings: ReturnType<typeof verificationSettings>; calibration: NonNullable<ControllerOptions["calibration"]>; leaseFailure?: Promise<never>; onSpawn?: (pid: number) => void }): Promise<void> {
    const { execution, issue, repository, baseRevision, initialPrompt, settings, calibration } = input;
    if (!calibration.baselineRoute || !baseRevision) return;
    const id = `${execution.id}-baseline`;
    if (!calibration.store.beginRun({ executionId: id, pairId: execution.id, issueId: issue.id, arm: "baseline", baseRevision, route: calibration.baselineRoute, sampled: true, startedAt: new Date().toISOString(), status: "running" })) return;
    let worktree: Worktree | undefined;
    try {
      worktree = await this.options.worktrees.create({ executionId: id, issueId: issue.id, repository, branch: `kor/calibration/${id}`, baseRevision, detached: true });
      const baseline: Execution = { id, issueId: issue.id, repository: repository.key, route: calibration.baselineRoute, worktree: worktree.path, branch: worktree.branch, status: "running", manifest: { executionId: id, issueId: issue.id, repository: repository.key, worktree: worktree.path, branch: worktree.branch, agents: [], acceptance: acceptance(issue) } };
      const result = await runVerifiedSessions({ execution: baseline, repository, initialPrompt, baseRevision, launcher: this.options.launcher, settings,
        ...(this.options.jev ? { jev: this.options.jev } : {}), calibration: calibration.store,
        ...(input.leaseFailure ? { leaseFailure: input.leaseFailure } : {}), ...(input.onSpawn ? { onSpawn: input.onSpawn } : {}) });
      calibration.store.finishRun(id, result.verificationReport.passed ? "verified" : "failed");
    } catch {
      // Baseline failures are visible in the report; never change the real issue's outcome.
      calibration.store.finishRun(id, "interrupted");
    } finally { if (worktree) await this.options.worktrees.remove?.(worktree); }
  }

  private startHeartbeat(claim: ExecutionClaim): { failed: Promise<never>; stop: () => void } {
    let timer: ReturnType<typeof setInterval> | undefined;
    let rejectFailure: (error: unknown) => void = () => undefined;
    const failed = new Promise<never>((_, reject) => { rejectFailure = reject; });
    failed.catch(() => undefined);
    timer = setInterval(() => {
      try { this.lease?.renew(claim, this.leaseTtlMs); }
      catch (error) { if (timer) clearInterval(timer); rejectFailure(error); }
    }, Math.max(100, Math.floor(this.leaseTtlMs / 3)));
    timer.unref?.();
    return { failed, stop: () => { if (timer) clearInterval(timer); } };
  }
  async runIssue(issueId: string, evidence: Evidence[] = []): Promise<ControllerRunResult> {
    if (!this.queue || !this.snapshots) throw new Error("runIssue requires a Linear runtime");
    this.queue.enqueue(issueId);
    const issue = (await this.snapshots.read(issueId)).issue;
    const assignment = this.options.linear?.store.getAssignment(issueId);
    if (!assignment) throw new Error(`Linear assignment missing for ${issueId}`);
    return this.dispatch({ id: assignment.executionId, issueId, repository: issue.repository ?? issue.teamKey, worktree: "", branch: `kor/${issueId}`, status: "queued", issue, evidence });
  }
  async runNext(): Promise<ControllerRunResult | undefined> {
    if (!this.lease || !this.snapshots) throw new Error("runNext requires a Linear runtime");
    const claim = this.lease.claim(this.owner, this.leaseTtlMs);
    if (!claim) return undefined;
    const issue = (await this.snapshots.read(claim.assignment.issueId)).issue;
    return this.dispatch({ id: claim.assignment.executionId, issueId: issue.id, repository: issue.repository ?? issue.teamKey, worktree: "", branch: `kor/${issue.id}`, status: "queued", issue, claim });
  }
  async reconcile(): Promise<ReconciliationReport> { return this.reconciler?.reconcile() ?? { assignments: [], expiredLeases: [], resumable: [], missingWorktrees: [], orphanedWorktrees: [] }; }
}

export function createController(options?: ControllerOptions): Controller {
  if (!options) throw new Error("Phase 2 controller requires repository, worktree, and launcher dependencies");
  return new ExecutionController(options);
}
