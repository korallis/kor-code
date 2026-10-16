import { randomUUID } from "node:crypto";
import { z } from "zod";
import { repositoryKeyForIssue } from "@kor-code/config";
import { JevDecisionCore, PersistentDecisionAuditLog, type DecisionRequest } from "@kor-code/jev";
import type { TrackerProjectSnapshot } from "@kor-code/tracker";
import type { ProjectDrive } from "@kor-code/mission-control";
import type { KorDaemon } from "./index.js";
import { ApiFailure } from "./api.js";

const driveSchema = z.object({
  id: z.string(), repository: z.string(), projectId: z.string(), name: z.string(), url: z.string(),
  status: z.enum(["running", "paused", "stopped", "finished"]), createdAt: z.string(), updatedAt: z.string(), error: z.string().nullable(),
  issues: z.array(z.object({
    issueId: z.string(), key: z.string(), title: z.string(), status: z.enum(["pending", "queued", "running", "review", "done", "held"]),
    reason: z.string().nullable(), retries: z.number().int().nonnegative(), admission: z.string().nullable(),
    manual: z.boolean().default(false),
  })),
});
type Drive = z.infer<typeof driveSchema>;
const MAX_RETRIES = 2;

/** A durable admission layer. Execution, repair, verification and merge retain their existing gates. */
export class ProjectDrives {
  private readonly drives: Drive[];
  private refreshing: Promise<void> | undefined;
  private stopping = false;
  private readonly revisions = new Map<string, number>();
  constructor(private readonly daemon: KorDaemon) {
    this.drives = daemon.store.readProjectDrives().map(payload => driveSchema.parse(JSON.parse(payload)));
  }
  list(repository: string): ProjectDrive[] { return this.drives.filter(drive => drive.repository === repository); }
  get busy(): boolean { return this.refreshing !== undefined; }
  async stop(): Promise<void> {
    this.stopping = true;
    for (const drive of this.drives) this.revisions.set(drive.id, (this.revisions.get(drive.id) ?? 0) + 1);
    await this.refreshing;
  }
  owns(issueId: string): boolean { return this.drives.some(drive => ["running", "paused"].includes(drive.status) && drive.issues.some(issue => issue.issueId === issueId && !issue.manual)); }
  excluded(): string[] {
    const latest = new Map<string, boolean>();
    for (const drive of this.drives) for (const issue of drive.issues) latest.set(issue.issueId, !issue.manual && ["running", "paused"].includes(drive.status) && (drive.status !== "running" || issue.status !== "queued" && issue.status !== "running"));
    return [...latest].filter(([, excluded]) => excluded).map(([issueId]) => issueId);
  }
  /** An explicit queue/retry returns scheduling to ordinary intake and its execution gates. */
  release(issueId: string): void {
    for (const drive of this.drives) for (const issue of drive.issues) if (issue.issueId === issueId && !issue.manual) {
      issue.manual = true;
      const assignment = this.daemon.store.findAssignment(issueId);
      issue.status = !["running", "paused"].includes(drive.status) ? "held" : assignment?.status === "queued" ? "queued" : assignment?.status === "running" ? "running" : "review";
      issue.reason = "Operator queued this issue independently of the drive";
      this.revisions.set(drive.id, (this.revisions.get(drive.id) ?? 0) + 1);
      this.save(drive);
    }
  }
  private save(drive: Drive): void {
    drive.updatedAt = new Date().toISOString();
    this.daemon.store.writeProjectDrive(drive.id, JSON.stringify(drive));
    this.daemon.events.publish({ kind: "invalidate", resources: ["projects", "brain", "issues"] });
  }
  private auditLog() {
    const store = this.daemon.store;
    return new PersistentDecisionAuditLog({ read: id => store.readDecisionAudit(id), write: (id, at, payload) => store.writeDecisionAudit(id, at, payload), update: (id, at, payload) => store.updateDecisionAudit(id, at, payload) });
  }
  private intelligence() {
    const audit = this.auditLog();
    return { audit, core: new JevDecisionCore(this.daemon.mission.jev(), audit) };
  }
  async baseRevision(repository: string): Promise<string> {
    const repo = this.daemon.config.repos[repository];
    if (!repo) throw new Error("Drive repository is no longer configured");
    const fetched = await this.daemon.mission.shippingCommand("git", ["fetch", "--no-tags", "origin", repo.defaultBranch], repo.path);
    if (fetched.code !== 0) throw new Error("Could not fetch the project's default branch; drive will retry before starting work");
    const revision = await this.daemon.mission.shippingCommand("git", ["rev-parse", "FETCH_HEAD"], repo.path);
    if (revision.code !== 0 || !/^[a-f0-9]{40,64}$/.test(revision.stdout.trim())) throw new Error("Could not resolve the fetched project revision");
    return revision.stdout.trim();
  }
  async projects(): Promise<Array<{ repository: string; project: TrackerProjectSnapshot }>> {
    const client = this.daemon.trackerClient();
    const getProject = client?.getProject?.bind(client);
    if (!getProject) throw new ApiFailure(503, "unavailable", "Linear project discovery is unavailable");
    const entries = Object.entries(this.daemon.config.repos).filter(([, repo]) => repo.tracker === "linear" && repo.linearProject);
    return Promise.all(entries.flatMap(([repository, repo]) => repo.linearProject ? [getProject(repo.linearProject).then(project => ({ repository, project }))] : []));
  }
  async start(repository: string, project: TrackerProjectSnapshot, id: string): Promise<ProjectDrive> {
    const existing = this.drives.find(drive => drive.id === id || drive.repository === repository && ["running", "paused"].includes(drive.status));
    if (existing) return existing;
    const repo = this.daemon.config.repos[repository];
    if (!repo || repo.tracker !== "linear" || repo.linearProject !== project.id) throw new ApiFailure(409, "conflict", "Project drive requires a configured Linear project");
    const client = this.daemon.trackerClient();
    if (!client?.listProjectIssues) throw new ApiFailure(503, "unavailable", "Linear project discovery is unavailable");
    // One lean paginated listing supplies the initial count; model admission runs in the background.
    const issues = await client.listProjectIssues(project.id);
    const concurrent = this.drives.find(drive => drive.id === id || drive.repository === repository && ["running", "paused"].includes(drive.status));
    if (concurrent) return concurrent;
    const now = new Date().toISOString();
    const drive: Drive = { id, repository, projectId: project.id, name: project.name, url: project.url, status: "running", createdAt: now, updatedAt: now, error: null, issues: issues.map(issue => ({ issueId: issue.id, key: issue.identifier ?? issue.id, title: issue.title, status: "pending", reason: "Awaiting background readiness assessment", retries: 0, admission: null, manual: false })) };
    this.drives.push(drive);
    this.save(drive);
    this.reconcile();
    return drive;
  }
  async control(id: string, action: "pause" | "resume" | "stop"): Promise<ProjectDrive> {
    const drive = this.drives.find(one => one.id === id);
    if (!drive) throw new ApiFailure(404, "not_found", "Project drive not found");
    if (drive.status === "stopped" || drive.status === "finished") throw new ApiFailure(409, "conflict", "This drive has ended; start another from the home box");
    const audit = this.auditLog();
    const request: DecisionRequest = { decisionId: `drive-${id}-${randomUUID()}`, executionId: id, kind: "intake", question: "Apply the operator's explicit project drive control", state: { action, status: drive.status }, inputs: [{ name: "operator control", value: action, source: "Mission Control" }], candidates: [action], overrides: { source: "operator", action } };
    // Operator controls are authoritative and audited locally, even when Jev is unreachable.
    audit.append({ request, recordedAt: new Date().toISOString(), overrides: { source: "operator", action }, response: { ...request, choice: action, confidence: 1, reasons: ["Explicit operator control"], evidenceRefs: [], policyChecks: [], applied: true, escalated: false } });
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    drive.status = action === "pause" ? "paused" : action === "stop" ? "stopped" : "running";
    this.save(drive);
    if (action === "stop") for (const issue of drive.issues) {
      if (issue.manual) continue;
      const assignment = this.daemon.store.findAssignment(issue.issueId);
      if (assignment && ["queued", "running"].includes(assignment.status)) this.daemon.cancel(issue.issueId);
      if (["pending", "queued", "running"].includes(issue.status)) { issue.status = "held"; issue.reason = "Stopped by operator"; }
    }
    audit.recordOutcome(request.decisionId, { action, status: drive.status });
    this.save(drive);
    if (action === "resume") this.reconcile();
    return drive;
  }
  reconcile(): void {
    if (this.stopping || this.refreshing) return;
    this.refreshing = (async () => {
      for (const drive of this.drives) if (drive.status === "running") await this.refresh(drive);
    })().finally(() => { this.refreshing = undefined; });
  }
  private async refresh(drive: Drive): Promise<void> {
    const before = JSON.stringify(drive);
    const revision = this.revisions.get(drive.id);
    const current = () => drive.status === "running" && this.revisions.get(drive.id) === revision;
    try {
      const client = this.daemon.trackerClient();
      if (!client?.getProject || !client.listProjectIssues) throw new Error("Linear project discovery is unavailable");
      const project = await client.getProject(drive.projectId);
      if (!current()) return;
      const issues = await client.listProjectIssues(drive.projectId);
      if (!current()) return;
      for (const issue of issues) if (repositoryKeyForIssue(issue, this.daemon.config) !== drive.repository) throw new Error("Project repository mapping changed; pause the drive and correct Settings");
      const milestones = new Map(project.milestones.map(milestone => [milestone.id, milestone]));
      issues.sort((a, b) => {
        const left = milestones.get(a.milestoneId ?? "");
        const right = milestones.get(b.milestoneId ?? "");
        return (a.priority || 5) - (b.priority || 5) || (left?.targetDate ?? "9999").localeCompare(right?.targetDate ?? "9999") || (left?.sortOrder ?? Infinity) - (right?.sortOrder ?? Infinity) || a.id.localeCompare(b.id);
      });
      for (const issue of issues) if (!drive.issues.some(entry => entry.issueId === issue.id)) drive.issues.push({ issueId: issue.id, key: issue.identifier ?? issue.id, title: issue.title, status: "pending", reason: null, retries: 0, admission: null, manual: false });
      drive.issues.sort((a, b) => issues.findIndex(issue => issue.id === a.issueId) - issues.findIndex(issue => issue.id === b.issueId));
      this.save(drive);
      const { audit, core } = this.intelligence();
      const rows = new Map(issues.map(issue => [issue.id, issue]));
      let admissions = 0;
      for (const entry of drive.issues) {
        if (!current()) return;
        const issue = rows.get(entry.issueId);
        if (!issue) { entry.status = "held"; entry.reason = "Issue was removed from this project"; continue; }
        if (issue.stateType === "completed") { entry.status = "done"; entry.reason = null; continue; }
        if (entry.manual) {
          const assignment = this.daemon.store.findAssignment(entry.issueId);
          entry.status = assignment?.status === "queued" ? "queued" : assignment?.status === "running" ? "running" : assignment && ["shipping", "review", "waiting", "complete"].includes(assignment.status) ? "review" : "held";
          entry.reason = entry.status === "held" ? assignment?.lastError ?? "Manual run needs operator attention" : "Operator queued this issue independently; monitoring its ordinary execution gates";
          continue;
        }
        if (issue.stateType === "canceled" || issue.stateType === "duplicate") { entry.status = "held"; entry.reason = "Issue is canceled or duplicate"; continue; }
        if (entry.admission !== null || entry.status === "held") continue;
        // Bound each pass so ready work starts before the entire project has been assessed.
        if (admissions++ >= 4) continue;
        const full = await client.getIssue(issue.id);
        if (!current()) return;
        const existing = this.daemon.store.findAssignment(issue.id);
        if (existing?.manifest?.shipping && existing.manifest.verification?.passed) {
          const decisionId = `drive-${drive.id}-monitor-${issue.id}`;
          const decision = audit.get(decisionId) ? audit.replay(decisionId) : await core.decide({ decisionId, executionId: drive.id, kind: "intake", question: "This issue already has a verified Kor execution in publication or review. Monitor its existing shipping and merge gates to reach Done; do not ask for implementation readiness again or rerun verified work. Hold only if the original issue explicitly requires a server-side or owner-only check.", state: z.json().parse({ issue: { title: full.title, description: full.description ?? "", acceptanceCriteria: full.acceptanceCriteria, labels: full.labels }, execution: existing.executionId, stage: existing.manifest.shipping.stage.kind, verified: true }), inputs: [{ name: "existing verified execution", value: existing.executionId }], candidates: ["monitor", "hold"] });
          if (!current()) return;
          entry.admission = decisionId;
          entry.status = decision.applied && decision.choice === "monitor" ? "review" : "held";
          entry.reason = entry.status === "review" ? "Monitoring existing verified publication" : "Jev held the existing execution for operator review";
          core.recordOutcome(decisionId, { action: entry.status === "review" ? "monitor" : "hold", executionId: existing.executionId });
          continue;
        }
        const decisionId = `drive-${drive.id}-admit-${issue.id}`;
        const request: DecisionRequest = { decisionId, executionId: drive.id, kind: "intake", question: "Can Kor autonomously implement this existing issue? Read its description, acceptance, labels and comments. Hold work explicitly requiring server-side/live production checks, owner access, credentials or a human-only check. A normal repository check or local test is runnable. Do not implement held work. Missing essential scope or acceptance is held. Dependencies are enforced separately by the scheduler.", state: z.json().parse({ project, issue: full }), inputs: [{ name: "issue", value: issue.id }], candidates: ["ready", "server-check", "owner-check", "needs-input"], criteria: { ready: "Concrete coding work and local verification that Kor can perform", "server-check": "Explicitly requires server-side, production or deployed-environment validation", "owner-check": "Explicitly requires owner action, private access or human validation", "needs-input": "Missing essential specification or acceptance criteria" } };
        const decision = audit.get(decisionId) ? audit.replay(decisionId) : await core.decide(request);
        if (!current()) return;
        entry.admission = decisionId;
        if (!decision.applied || decision.choice !== "ready" || !full.acceptanceCriteria.length) {
          entry.status = "held";
          entry.reason = !full.acceptanceCriteria.length ? "Needs explicit acceptance criteria" : !decision.applied ? "Jev is unsure this issue can run autonomously" : decision.choice === "server-check" ? "Requires a server-side check" : decision.choice === "owner-check" ? "Requires an owner check" : "Needs essential scope or input";
          core.recordOutcome(decisionId, { action: "hold", reason: entry.reason });
        }
      }
      // Persist admissions before any assignment can become eligible, including across a restart.
      this.save(drive);
      for (const issue of issues) {
        if (!current()) return;
        const entry = drive.issues.find(one => one.issueId === issue.id);
        if (!entry || entry.manual || entry.admission === null || entry.status === "done" || entry.status === "held") continue;
        const assignment = this.daemon.store.findAssignment(issue.id);
        const shipping = assignment?.manifest?.shipping;
        const decisionHold = shipping?.evidence.find(item => item.id === `shipping-${assignment?.executionId}-decision-hold`);
        if (assignment?.status === "blocked" && decisionHold) {
          entry.status = "held"; entry.reason = decisionHold.summary;
          if (decisionHold.source && audit.get(decisionHold.source)) core.recordOutcome(decisionHold.source, { action: "hold", driveId: drive.id, issueId: issue.id, reason: entry.reason });
          continue;
        }
        // Viable repairs have already been requeued by advanceShipping. An
        // unqueued repair reason is a terminal hold for this drive, not progress.
        if (assignment && shipping?.repairReason && assignment.status !== "queued" && assignment.status !== "running") {
          entry.status = "held";
          entry.reason = assignment.lastError ?? shipping.error ?? shipping.repairReason;
          const decisionId = shipping.mergeDecision?.decisionId ?? shipping.review?.decisionId;
          if (decisionId && audit.get(decisionId)) core.recordOutcome(decisionId, { action: "hold", driveId: drive.id, issueId: issue.id, reason: entry.reason });
          continue;
        }
        if (assignment && ["running", "shipping", "review", "waiting"].includes(assignment.status)) {
          entry.status = assignment.status === "running" ? "running" : "review";
          entry.reason = assignment.status === "running" ? null : assignment.lastError ?? shipping?.error ?? (assignment.status === "waiting" ? "Awaiting configured publication approval" : "Waiting for verified publication and merge");
          continue;
        }
        if (assignment?.status === "complete") { entry.status = "review"; entry.reason = "Waiting for Linear to confirm Done"; continue; }
        if (assignment?.status === "blocked" && assignment.manifest?.shipping && !assignment.manifest.shipping.repairReason && assignment.manifest.shipping.stage.kind !== "closed") {
          entry.status = "review"; entry.reason = assignment.lastError ?? assignment.manifest.shipping.error ?? "Publication synchronization will retry"; continue;
        }
        if (assignment && ["failed", "blocked", "canceled"].includes(assignment.status)) {
          if (assignment.status !== "failed" || assignment.manifest?.verification || entry.retries >= MAX_RETRIES) {
            entry.status = "held"; entry.reason = assignment.lastError ?? "Run needs operator input or exhausted its repair budget"; continue;
          }
          const decisionId = `drive-${drive.id}-retry-${issue.id}-${assignment.attempts}`;
          const decision = audit.get(decisionId) ? audit.replay(decisionId) : await core.decide({ decisionId, executionId: drive.id, kind: "intake", question: "Should Kor retry this failed execution within its bounded project drive retry budget? Only retry transient execution or infrastructure failures. Hold unresolved scope, permissions, owner checks, exhausted verification or repeated deterministic errors.", state: { issue, error: assignment.lastError ?? null, retries: entry.retries, maximum: MAX_RETRIES }, inputs: [{ name: "failed execution", value: assignment.executionId }], candidates: ["retry", "hold"] });
          if (!current()) return;
          if (!decision.applied || decision.choice !== "retry") { entry.status = "held"; entry.reason = assignment.lastError ?? "Jev held the failed run"; continue; }
          if (this.daemon.retry(issue.id)) entry.retries++;
          core.recordOutcome(decisionId, { action: "retry", retries: entry.retries });
        }
        const blockers = issue.dependencies.filter(dependency => dependency.stateType !== "completed");
        if (blockers.length) { entry.status = "pending"; entry.reason = `Waiting for blockers to be Done: ${blockers.map(blocker => drive.issues.find(one => one.issueId === blocker.id)?.key ?? blocker.id).join(", ")}`; continue; }
        if (!assignment && issue.stateType === "started") { entry.status = "held"; entry.reason = "Already in progress outside this drive"; continue; }
        if (assignment?.status !== "queued") {
          const decisionId = `drive-${drive.id}-queue-${issue.id}-${assignment?.attempts ?? 0}`;
          const decision = audit.get(decisionId) ? audit.replay(decisionId) : await core.decide({ decisionId, executionId: drive.id, kind: "intake", question: "Admit this previously assessed ready issue to the project drive queue now that every blocking dependency is Done. Respect the established ready admission, priority and milestone order. Choose wait only if a supplied blocking fact prevents autonomous execution.", state: z.json().parse({ issue, admission: entry.admission, project, blockers }), inputs: [{ name: "ready issue", value: issue.id }], candidates: ["queue", "wait"], policyChecks: [{ name: "all blockers Done", result: blockers.length === 0 ? "pass" : "fail" }] });
          if (!current()) return;
          if (!decision.applied || decision.choice !== "queue") { entry.status = "held"; entry.reason = "Jev held queue admission"; continue; }
          core.recordOutcome(decisionId, { action: "queue", issueId: issue.id, driveId: drive.id });
        }
        entry.status = "queued"; entry.reason = null;
        // Save eligibility before enqueue; an interrupted enqueue is replayed on the next poll.
        this.save(drive);
        this.daemon.store.enqueue(issue.id, { issueKey: entry.key, issueTitle: issue.title, repository: drive.repository });
        // Rows enter in priority / milestone order; claim preserves this order for equal priority.
        this.daemon.store.setPriority(issue.id, issue.priority);
        if (entry.admission && !audit.get(entry.admission)?.response.observedOutcome) core.recordOutcome(entry.admission, { action: "queue", issueId: issue.id, driveId: drive.id, blockersDone: true });
      }
      const progressing = drive.issues.some(entry => !entry.manual && entry.admission === null && entry.status === "pending" || ["queued", "running", "review"].includes(entry.status));
      if (!progressing) for (const entry of drive.issues) if (entry.status === "pending") { entry.status = "held"; entry.reason = `No runnable path: ${entry.reason ?? "dependency cycle or external blocker"}`; }
      if (drive.issues.every(entry => entry.status === "done" || entry.status === "held")) drive.status = "finished";
      drive.error = null;
    } catch (error) {
      if (!current()) return;
      drive.error = error instanceof Error ? error.message.slice(0, 500) : "Project synchronization failed; will retry";
    }
    if (JSON.stringify(drive) !== before) this.save(drive);
  }
}
