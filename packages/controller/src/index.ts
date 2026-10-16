import { dirname, isAbsolute, relative, resolve } from "node:path";
import { cp, mkdir } from "node:fs/promises";
import type { CatalogueModel, ContextManifest, Evidence, Execution, Route, SessionSpend } from "@kor-code/core";
import { JevDecisionCore, redact, preflightRequests, readinessBlocksDispatch, type SessionOverrides } from "@kor-code/jev";
import type { TrackerClient, TrackerIssue, WorkflowMapping, ExecutionClaim } from "@kor-code/tracker";
import { AgentSessionWriter, DurableQueue, ExecutionLease, TrackerStore, SnapshotReader, hasScreenshot } from "@kor-code/tracker";
import { createHash, randomUUID } from "node:crypto";
import { RepositoryRegistry, type RepositoryLookup, type Repository } from "./repository.js";
import { type Worktree, type WorktreeManager } from "./worktree.js";
import { ConcurrencyLimiter } from "./limiter.js";
import { type SessionResult, type SessionLauncherLike } from "./launcher.js";
import { RestartReconciler, type ReconciliationReport } from "./reconcile.js";
import { VerificationError, VerificationTracker } from "@kor-code/verification";
import { CalibrationStore, sampledPair, type CalibrationRun, type RunOutcome } from "@kor-code/calibration";
import { ExecutionVerificationError, verificationBase, verificationSettings, type VerificationOptions } from "./verification.js";

import { runVerifiedSessions } from "./attempts.js";
import { buildContextManifest, contextPrompt, ticketImages } from "@kor-code/context";

export * from "./repository.js";
export * from "./worktree.js";
export * from "./limiter.js";
export * from "./events.js";
export * from "./launcher.js";
export * from "./session-permissions.js";
export * from "./tool-plan.js";
export * from "./reconcile.js";
export * from "./verification.js";

export interface ControllerTrackerRuntime { store: TrackerStore; client: TrackerClient; workflow: WorkflowMapping }
export type VerificationFactory = (execution: Execution) => VerificationTracker;
export interface ControllerOptions {
  repositories: RepositoryLookup;
  worktrees: WorktreeManager;
  launcher: SessionLauncherLike;
  tracker?: ControllerTrackerRuntime;
  fetchImage?: (url: string) => Promise<Response>;
  /** @deprecated */
  linear?: ControllerTrackerRuntime;
  jev?: JevDecisionCore;
  catalogue?: readonly CatalogueModel[];
  limits?: ConcurrencyLimiter;
  owner?: string;
  defaultRoute?: Route;
  promptPrefix?: string;
  leaseTtlMs?: number;
  verification?: VerificationFactory;
  verificationOptions?: VerificationOptions;
  /** Reserve each session identity in the owning runtime before launching it. */
  reserveAttempt?: (executionId: string, attempt: number) => string;
  onStage?: (executionId: string, stage: "context" | "execute" | "verify") => void;
  onSpend?: (executionId: string, spend: SessionSpend) => void;
  calibration?: { store: CalibrationStore; sampleRate?: number; baselineRoute?: Route };
  /** A sampled calibration baseline for an execution started or finished; it never ships or changes the execution's outcome. */
  onBaseline?: (executionId: string, baseline: CalibrationBaseline) => void;
  /** Operator skill, playbook and tool overrides for an execution; never applied to a calibration baseline. */
  sessionOverrides?: (executionId: string) => SessionOverrides;
}
export interface CalibrationBaseline { purpose: "route" | "skills"; model: string; status: "started" | Exclude<CalibrationRun["status"], "running">; costUsd?: number }
export interface ControllerRunResult {
  execution: Execution;
  issue: TrackerIssue;
  repository: Repository;
  worktree: Worktree;
  session: SessionResult;
  claim?: ExecutionClaim;
}
export interface Controller {
  canRepair(execution: Execution): boolean;
  dispatch(execution: Execution & { issue?: TrackerIssue; prompt?: string; claim?: ExecutionClaim; evidence?: Evidence[]; onSpawn?: (pid: number) => void; signal?: AbortSignal }): Promise<ControllerRunResult>;
  runIssue(issueId: string, evidence?: Evidence[]): Promise<ControllerRunResult>;
  runNext(): Promise<ControllerRunResult | undefined>;
  reconcile(): Promise<ReconciliationReport>;
  recordTerminalOutcome(executionId: string, outcome: RunOutcome): void;
}

function acceptance(issue: TrackerIssue) { return issue.acceptanceCriteria.map((description, index) => ({ id: `acceptance-${index + 1}`, description, required: true })); }
function promptFor(issue: TrackerIssue, prefix = ""): string {
  const criteria = issue.acceptanceCriteria.length > 0 ? issue.acceptanceCriteria.map(item => `- ${item}`).join("\n") : "- No explicit acceptance criteria were supplied.";
  return `${prefix}${issue.tracker === "github" ? "GitHub" : "Linear"} issue ${issue.id}: ${issue.title}\n\n${issue.description ?? ""}\n\nAcceptance criteria:\n${criteria}`.trim();
}
interface ChosenRoute { route?: Route; decisionId?: string }
async function chooseRoute(options: ControllerOptions, executionId: string, issue: TrackerIssue, existing?: Route): Promise<ChosenRoute> {
  if (existing) return { route: existing, ...(existing.decisionId ? { decisionId: existing.decisionId } : {}) };
  const catalogue = options.catalogue ?? [];
  const jev = options.jev;
  if (!jev || catalogue.length === 0) return { ...(options.defaultRoute ? { route: options.defaultRoute } : {}) };
  const first = catalogue.find(model => model.available !== false);
  if (!first) throw new Error("No available model routes in catalogue");
  const input = { executionId,
    issue: { ...issue, hasScreenshot: hasScreenshot(issue), dependencies: issue.dependencies.map(dependency => ({ id: dependency.id, state: dependency.stateType })) },
    verifiedModels: catalogue, defaultRoute: options.defaultRoute ?? { model: first.model, provider: first.provider, accountPolicy: "fill-first" as const, sessionAffinity: true } };
  const baseRevision = createHash("sha256").update(JSON.stringify(preflightRequests(input)[0]?.inputs.find(input => input.name === "routing-input")?.value)).digest("hex").slice(0, 16);
  let decisionRevision = baseRevision;
  for (let retry = 1; ; retry++) {
    const saved = preflightRequests({ ...input, decisionRevision }).map(request => jev.get(request.decisionId));
    if (!saved.some(record => record && record.response.policyChecks.some(check => check.name === "jev-available" && check.result === "fail"))) break;
    decisionRevision = `${baseRevision}-retry-${retry}`;
  }
  const plan = await jev.planIssue({ ...input, decisionRevision });
  const readiness = plan.decisions.find(decision => decision.kind === "readiness");
  if (readinessBlocksDispatch(readiness)) throw new Error(readiness?.reasons.join(" ") ?? "Issue readiness could not be established");
  return { route: plan.route, ...(plan.route.decisionId ? { decisionId: plan.route.decisionId } : {}) };
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
  private readonly reserveAttempt: (executionId: string, attempt: number) => string;
  constructor(private readonly options: ControllerOptions) {
    if (!options.tracker && options.linear) options.tracker = options.linear;
    this.limiter = options.limits ?? new ConcurrencyLimiter({ total: 1 });
    this.leaseTtlMs = options.leaseTtlMs ?? 60_000;
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs <= 0) throw new Error("Lease TTL must be positive");
    this.reserveAttempt = options.reserveAttempt ?? ((executionId, attempt) => options.tracker?.store.reserveVerificationAttempt(executionId, attempt) ?? randomUUID());
    this.owner = options.owner ?? `controller-${process.pid}-${randomUUID()}`;
    if (options.tracker) {
      this.queue = new DurableQueue(options.tracker.store);
      this.lease = new ExecutionLease(options.tracker.store);
      this.writer = new AgentSessionWriter(options.tracker.store, options.tracker.client, options.tracker.workflow);
      this.snapshots = new SnapshotReader(options.tracker.client);
      this.reconciler = new RestartReconciler(options.tracker.store, options.worktrees);
    }
  }
  canRepair(execution: Execution): boolean {
    return (execution.verification?.attempts.length ?? 0) <= verificationSettings(this.options.verificationOptions).maxRepairs;
  }
  async dispatch(input: Execution & { issue?: TrackerIssue; prompt?: string; claim?: ExecutionClaim; evidence?: Evidence[]; onSpawn?: (pid: number) => void; signal?: AbortSignal }): Promise<ControllerRunResult> {
    const issue = input.issue ?? (this.snapshots ? (await this.snapshots.read(input.issueId)).issue : undefined);
    if (!issue) throw new Error("Controller dispatch requires an issue or a tracker runtime");
    const repository = await this.options.repositories.resolve(input.repository);
    const chosen = await chooseRoute(this.options, input.id, issue, input.route);
    const route = chosen.route;
    const decisionId = chosen.decisionId;
    const permit = await this.limiter.acquire({ repository: repository.key, ...(route?.provider ? { provider: route.provider } : {}) });
    let worktree: Worktree | undefined;
    let claim: ExecutionClaim | undefined;
    let heartbeat: { failed: Promise<never>; stop: () => void } | undefined;
    const leaseAbort = new AbortController();
    const signal = input.signal ? AbortSignal.any([input.signal, leaseAbort.signal]) : leaseAbort.signal;
    try {
      if (this.lease && this.writer) {
        claim = input.claim ?? this.lease.claim(this.owner, this.leaseTtlMs, input.issueId);
        if (!claim) throw new Error(`No execution lease available for ${input.issueId}`);
      }
      this.options.onStage?.(input.id, "context");
      worktree = await this.options.worktrees.create({ executionId: input.id, issueId: input.issueId, repository, branch: input.branch });
      const execution: Execution = { ...input, writerModels: [...new Set([...(input.writerModels ?? []), ...(route ? [route.model] : [])])], repository: repository.key, worktree: worktree.path, branch: worktree.branch, status: "running", ...(route ? { route } : {}), manifest: { executionId: input.id, issueId: input.issueId, repository: repository.key, worktree: worktree.path, branch: worktree.branch, agents: [], acceptance: acceptance(issue) } };
      const verification = this.options.verification?.(execution) ?? (this.writer ? new VerificationTracker(execution.manifest?.acceptance ?? [], execution.id) : undefined);
      const calibrationRoute = route ?? this.options.calibration?.baselineRoute;
      if (this.lease && this.writer) {
        if (!claim) throw new Error(`No execution lease available for ${input.issueId}`);
        this.writer.start(claim, execution);
        await this.writer.flush();
      }
      heartbeat = claim && this.lease ? this.startHeartbeat(claim) : undefined;
      heartbeat?.failed.catch(error => leaseAbort.abort(error));
      const baseRevision = this.options.calibration?.store.run(input.id)?.baseRevision ?? (input.continueVerification ? input.verification?.attempts[0]?.publication?.baseRevision : undefined) ?? await verificationBase(worktree.path);
      const calibrationStartedAt = new Date().toISOString();
      if (this.options.calibration && calibrationRoute) {
        const arm = route?.label === "jev" ? "jev" : route?.label === "override" ? "override" : "fallback";
        const existing = this.options.calibration.store.run(input.id);
        if (existing) this.options.calibration.store.resumeRun(input.id, calibrationStartedAt, calibrationRoute);
        else this.options.calibration.store.beginRun({ executionId: input.id, pairId: input.id, issueId: input.issueId, arm, baseRevision, route: calibrationRoute, sampled: arm === "jev" && sampledPair(input.id, this.options.calibration.sampleRate ?? 0.25), startedAt: calibrationStartedAt, status: "running" });
      }
      const taskPrompt = input.prompt ?? promptFor(issue, this.options.promptPrefix);
      const fetchImage = this.options.fetchImage ?? this.options.tracker?.client.fetchImage?.bind(this.options.tracker.client);
      const contextBuild = buildContextManifest({ executionId: input.id, repository: repository.key, worktree: worktree.path,
        task: taskPrompt, documents: issue.documents, ...(input.evidence ? { evidence: input.evidence } : {}), includeFiles: true, maxCharacters: 24_000, maxSourceCharacters: 600,
        images: ticketImages([issue.description ?? "", ...issue.comments.map(comment => comment.body), ...issue.documents.map(document => document.content)], issue.resources),
        issueIdentifier: issue.identifier ?? issue.id, ...(fetchImage ? { fetchImage } : {}),
        ...(this.options.jev ? { jev: this.options.jev } : {}) });
      const context = await (heartbeat ? Promise.race([contextBuild, heartbeat.failed]) : contextBuild);
      const initialPrompt = String(redact(taskPrompt)) + contextPrompt(context);
      const settings = verificationSettings(this.options.verificationOptions);
      const sessionOverrides = this.options.sessionOverrides;
      const { session, latest, verificationReport } = await runVerifiedSessions({ execution, repository, initialPrompt, baseRevision,
        launcher: this.options.launcher, settings, reserveAttempt: this.reserveAttempt, ...(sessionOverrides ? { overrides: () => sessionOverrides(input.id) } : {}), ...(this.options.onStage ? { onStage: this.options.onStage } : {}), ...(this.options.onSpend ? { onSpend: this.options.onSpend } : {}), ...(this.options.jev ? { jev: this.options.jev } : {}),
        ...(this.options.calibration && calibrationRoute ? { calibration: this.options.calibration.store } : {}),
        ...(decisionId ? { decisionId } : {}),
        ...(heartbeat ? { leaseFailure: heartbeat.failed } : {}), ...(input.onSpawn ? { onSpawn: input.onSpawn } : {}), signal });
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
          if (this.options.calibration) await this.runBaselineIfSampled({ execution, issue, repository, baseRevision, initialPrompt, context, settings, calibration: this.options.calibration });
          throw failure;
        }
        await this.writer.complete(claim, { summary: `Execution ${input.id} completed`, evidence: verification?.evidence() ?? [] });
        await this.writer.flush();
      }
      if (latest.blockers.length > 0) {
        this.finishCalibration(input.id, "failed", "controller.verification-block");
        if (this.options.calibration) await this.runBaselineIfSampled({ execution, issue, repository, baseRevision, initialPrompt, context, settings, calibration: this.options.calibration });
        throw new ExecutionVerificationError(verificationReport);
      }
      this.finishCalibration(input.id, "verified", "controller.completed");
      if (this.options.calibration) await this.runBaselineIfSampled({ execution, issue, repository, baseRevision, initialPrompt, context, settings, calibration: this.options.calibration, ...(input.onSpawn ? { onSpawn: input.onSpawn } : {}) });
      return { execution: completedExecution, issue, repository, worktree, session, ...(claim ? { claim } : {}) };
    } catch (error) {
      const run = this.options.calibration?.store.run(input.id);
      if (run?.status === "running") this.finishCalibration(input.id, error instanceof ExecutionVerificationError || error instanceof VerificationError ? "failed" : error instanceof Error && /Jev escalated route selection/.test(error.message) ? "escalated" : "interrupted", error instanceof ExecutionVerificationError || error instanceof VerificationError ? "controller.verification-block" : error instanceof Error && /Jev escalated route selection/.test(error.message) ? "controller.escalated" : "controller.abandoned");
      if (claim && this.options.tracker && !input.signal) {
        try { this.options.tracker.store.release(claim, 1_000); } catch { /* expired claims are reclaimed on restart */ }
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
    if (!calibration || !run) return;
    const status = outcome.status === "merged" ? "verified" : outcome.status === "rejected" ? "failed" : outcome.status === "escalated" ? "escalated" : "interrupted";
    if (run.status !== status) calibration.store.finishRun(executionId, status);
    calibration.store.recordExecutionOutcome(executionId, outcome);
  }
  private async runBaselineIfSampled(input: { execution: Execution; issue: TrackerIssue; repository: Repository; baseRevision: string; initialPrompt: string; context: ContextManifest; settings: ReturnType<typeof verificationSettings>; calibration?: NonNullable<ControllerOptions["calibration"]>; onSpawn?: (pid: number) => void }): Promise<void> {
    const calibration = input.calibration;
    const run = calibration?.store.run(input.execution.id);
    if (!calibration || run?.arm !== "jev" || !run.sampled) return;
    await this.runBaseline({ ...input, calibration });
    const offered = calibration.store.decisions("skills").some(record => record.request.executionId === input.execution.id && record.response.plan?.skills.some(skill => skill.tier !== "hidden"));
    if (offered) await this.runBaseline({ ...input, calibration, purpose: "skills" });
  }
  private async runBaseline(input: { purpose?: "skills"; execution: Execution; issue: TrackerIssue; repository: Repository; baseRevision: string; initialPrompt: string; context: ContextManifest; settings: ReturnType<typeof verificationSettings>; calibration: NonNullable<ControllerOptions["calibration"]>; leaseFailure?: Promise<never>; onSpawn?: (pid: number) => void }): Promise<void> {
    const { execution, issue, repository, baseRevision, initialPrompt, settings, calibration } = input;
    const skillsBaseline = input.purpose === "skills";
    const route = skillsBaseline ? execution.route : calibration.baselineRoute;
    if (!route || !baseRevision) return;
    const id = `${execution.id}-${skillsBaseline ? "skills-baseline" : "baseline"}`;
    if (!calibration.store.beginRun({ executionId: id, pairId: skillsBaseline ? `${execution.id}-skills` : execution.id, ...(skillsBaseline ? { purpose: "skills" } : {}), issueId: issue.id, arm: "baseline", baseRevision, route, sampled: true, startedAt: new Date().toISOString(), status: "running" })) return;
    const report = (status: CalibrationBaseline["status"], costUsd?: number) => this.options.onBaseline?.(execution.id, { purpose: skillsBaseline ? "skills" : "route", model: route.model, status, ...(costUsd !== undefined ? { costUsd } : {}) });
    report("started");
    let worktree: Worktree | undefined;
    try {
      worktree = await this.options.worktrees.create({ executionId: id, issueId: issue.id, repository, branch: `kor/calibration/${id}`, baseRevision, detached: true });
      for (const source of input.context.sources) {
        if (source.purpose !== "image" || source.path === "ticket") continue;
        const destination = resolve(worktree.path, source.path);
        const local = relative(worktree.path, destination);
        if (local.startsWith("..") || isAbsolute(local)) throw new Error("Baseline image path escapes worktree");
        await mkdir(dirname(destination), { recursive: true });
        await cp(resolve(execution.worktree, source.path), destination);
      }
      const baseline: Execution = { id, issueId: issue.id, repository: repository.key, route, worktree: worktree.path, branch: worktree.branch, status: "running", manifest: { executionId: id, issueId: issue.id, repository: repository.key, worktree: worktree.path, branch: worktree.branch, agents: [], acceptance: acceptance(issue) } };
      const result = await runVerifiedSessions({ signal: AbortSignal.timeout(settings.checkTimeoutMs), execution: baseline, repository, initialPrompt, baseRevision, ...(skillsBaseline ? { skillsDisabled: true, pairedTools: calibration.store.metrics().filter(metric => metric.executionId === execution.id).map(metric => metric.tools) } : {}), launcher: this.options.launcher, settings, reserveAttempt: this.reserveAttempt,
        ...(this.options.onSpend ? { onSpend: this.options.onSpend } : {}),
        ...(this.options.jev ? { jev: this.options.jev } : {}), calibration: calibration.store,
        ...(input.leaseFailure ? { leaseFailure: input.leaseFailure } : {}), ...(input.onSpawn ? { onSpawn: input.onSpawn } : {}) });
      calibration.store.finishRun(id, result.verificationReport.passed ? "verified" : "failed");
      report(result.verificationReport.passed ? "verified" : "failed", result.verificationReport.costUsd);
    } catch {
      // Baseline failures are visible in the report; never change the real issue's outcome.
      calibration.store.finishRun(id, "interrupted");
      report("interrupted");
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
    if (!this.queue || !this.snapshots) throw new Error("runIssue requires a tracker runtime");
    this.queue.enqueue(issueId);
    const issue = (await this.snapshots.read(issueId)).issue;
    const assignment = this.options.tracker?.store.getAssignment(issueId);
    if (!assignment) throw new Error(`tracker assignment missing for ${issueId}`);
    return this.dispatch({ id: assignment.executionId, issueId, repository: issue.repository ?? issue.teamKey, worktree: "", branch: `kor/${issue.identifier}`, status: "queued", issue, evidence });
  }
  async runNext(): Promise<ControllerRunResult | undefined> {
    if (!this.lease || !this.snapshots) throw new Error("runNext requires a tracker runtime");
    const claim = this.lease.claim(this.owner, this.leaseTtlMs);
    if (!claim) return undefined;
    const issue = (await this.snapshots.read(claim.assignment.issueId)).issue;
    return this.dispatch({ id: claim.assignment.executionId, issueId: issue.id, repository: issue.repository ?? issue.teamKey, worktree: "", branch: `kor/${issue.identifier}`, status: "queued", issue, claim });
  }
  async reconcile(): Promise<ReconciliationReport> { return this.reconciler?.reconcile() ?? { assignments: [], expiredLeases: [], resumable: [], missingWorktrees: [], orphanedWorktrees: [] }; }
}

export function createController(options?: ControllerOptions): Controller {
  if (!options) throw new Error("Phase 2 controller requires repository, worktree, and launcher dependencies");
  return new ExecutionController(options);
}

/** @deprecated */
export type ControllerLinearRuntime = ControllerTrackerRuntime;
