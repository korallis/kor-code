import type { CatalogueModel, Evidence, Execution, Route } from "@kor-code/core";
import { JevDecisionCore, routeFromDecision } from "@kor-code/jev";
import type { LinearClient, LinearIssue, WorkflowMapping, ExecutionClaim } from "@kor-code/linear";
import { AgentSessionWriter, DurableQueue, ExecutionLease, LinearStore, SnapshotReader } from "@kor-code/linear";
import { randomUUID } from "node:crypto";
import { RepositoryRegistry, type RepositoryLookup, type Repository } from "./repository.js";
import { type Worktree, type WorktreeManager } from "./worktree.js";
import { ConcurrencyLimiter } from "./limiter.js";
import { type SessionLaunch, type SessionResult, type SessionLauncherLike } from "./launcher.js";
import { RestartReconciler, type ReconciliationReport } from "./reconcile.js";
import { VerificationError, VerificationTracker } from "@kor-code/verification";

export * from "./repository.js";
export * from "./worktree.js";
export * from "./limiter.js";
export * from "./events.js";
export * from "./launcher.js";
export * from "./reconcile.js";

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
  dispatch(execution: Execution & { issue?: LinearIssue; prompt?: string; claim?: ExecutionClaim; evidence?: Evidence[] }): Promise<ControllerRunResult>;
  runIssue(issueId: string, evidence?: Evidence[]): Promise<ControllerRunResult>;
  runNext(): Promise<ControllerRunResult | undefined>;
  reconcile(): Promise<ReconciliationReport>;
}

function acceptance(issue: LinearIssue) { return issue.acceptanceCriteria.map((description, index) => ({ id: `acceptance-${index + 1}`, description, required: true })); }
function promptFor(issue: LinearIssue, prefix = ""): string {
  const criteria = issue.acceptanceCriteria.length > 0 ? issue.acceptanceCriteria.map(item => `- ${item}`).join("\n") : "- No explicit acceptance criteria were supplied.";
  return `${prefix}Linear issue ${issue.id}: ${issue.title}\n\n${issue.description ?? ""}\n\nAcceptance criteria:\n${criteria}`.trim();
}
async function chooseRoute(options: ControllerOptions, executionId: string, issue: LinearIssue, existing?: Route): Promise<Route | undefined> {
  if (existing) return existing;
  const catalogue = options.catalogue ?? [];
  if (!options.jev || catalogue.length === 0) return options.defaultRoute;
  const candidates = catalogue.filter(item => item.available !== false).map(item => item.model);
  if (candidates.length === 0) throw new Error("No available model routes in catalogue");
  const decision = await options.jev.selectRoute({ decisionId: `route-${executionId}`, executionId, kind: "route", question: "Select the available model route that best fits this Linear issue and its acceptance conditions.", state: { issueId: issue.id, title: issue.title, description: issue.description ?? "", acceptance: issue.acceptanceCriteria, dependencies: issue.dependencies }, inputs: [{ name: "issue", value: issue.title, source: "linear" }], candidates, policyChecks: [{ name: "catalogue-nonempty", result: "pass" }] });
  if (decision.escalated) throw new Error(`Jev escalated route selection for ${executionId}`);
  return routeFromDecision(decision, catalogue, { accountPolicy: "fill-first", sessionAffinity: true });
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
  async dispatch(input: Execution & { issue?: LinearIssue; prompt?: string; claim?: ExecutionClaim; evidence?: Evidence[] }): Promise<ControllerRunResult> {
    const issue = input.issue ?? (this.snapshots ? (await this.snapshots.read(input.issueId)).issue : undefined);
    if (!issue) throw new Error("Controller dispatch requires an issue or a Linear runtime");
    const repository = await this.options.repositories.resolve(input.repository);
    const route = await chooseRoute(this.options, input.id, issue, input.route);
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
      if (this.lease && this.writer) {
        if (!claim) throw new Error(`No execution lease available for ${input.issueId}`);
        this.writer.start(claim, execution);
        await this.writer.flush();
      }
      const launch: SessionLaunch = { execution, repositoryPath: repository.path, worktreePath: worktree.path, prompt: input.prompt ?? promptFor(issue, this.options.promptPrefix), ...(route ? { route } : {}) };
      heartbeat = claim && this.lease ? this.startHeartbeat(claim) : undefined;
      const sessionPromise = this.options.launcher.launch(launch);
      const session = await Promise.race([sessionPromise, ...(heartbeat ? [heartbeat.failed] : [])]);
      heartbeat?.stop();
      if (this.writer && claim) {
        if (session.exitCode === 0) {
          const sessionEvidence: Evidence = { id: `session-${input.id}`, kind: "provider", summary: "Sandbox session exited with status 0", status: "pass" };
          verification?.addMany([...(input.evidence ?? []), sessionEvidence]);
          try { verification?.assertComplete(); }
          catch (error) {
            if (error instanceof VerificationError && this.writer && claim) {
              await this.writer.recordVerificationBlock(claim, { ...execution, status: "blocked" }, error.findings);
              await this.writer.flush();
            }
            throw error;
          }
          await this.writer.complete(claim, { summary: `Execution ${input.id} completed`, evidence: verification?.evidence() ?? [sessionEvidence] });
        }
        else this.options.linear?.store.release(claim, 1_000);
        await this.writer.flush();
      }
      return { execution, issue, repository, worktree, session, ...(claim ? { claim } : {}) };
    } catch (error) {
      if (claim && this.options.linear) {
        try { this.options.linear.store.release(claim, 1_000); } catch { /* expired claims are reclaimed on restart */ }
      }
      throw error;
    } finally {
      heartbeat?.stop();
      permit.release();
    }
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
