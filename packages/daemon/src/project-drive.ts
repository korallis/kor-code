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
  })),
});
type Drive = z.infer<typeof driveSchema>;
const MAX_RETRIES = 2;

/** A durable admission layer. Execution, repair, verification and merge retain their existing gates. */
export class ProjectDrives {
  private readonly drives: Drive[];
  private operations: Promise<unknown> = Promise.resolve();
  constructor(private readonly daemon: KorDaemon) {
    this.drives = daemon.store.readProjectDrives().map(payload => driveSchema.parse(JSON.parse(payload)));
  }
  list(repository: string): ProjectDrive[] { return this.drives.filter(drive => drive.repository === repository); }
  owns(issueId: string): boolean { return this.drives.some(drive => drive.issues.some(issue => issue.issueId === issueId)); }
  excluded(): string[] {
    const latest = new Map<string, boolean>();
    for (const drive of this.drives) for (const issue of drive.issues) latest.set(issue.issueId, drive.status !== "running" || issue.status !== "queued" && issue.status !== "running");
    return [...latest].filter(([, excluded]) => excluded).map(([issueId]) => issueId);
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.operations.then(action);
    this.operations = next.catch(() => undefined);
    return next;
  }
  private save(drive: Drive): void {
    drive.updatedAt = new Date().toISOString();
    this.daemon.store.writeProjectDrive(drive.id, JSON.stringify(drive));
    this.daemon.events.publish({ kind: "invalidate", resources: ["projects", "brain", "issues"] });
  }
  private intelligence() {
    const store = this.daemon.store;
    const audit = new PersistentDecisionAuditLog({ read: id => store.readDecisionAudit(id), write: (id, at, payload) => store.writeDecisionAudit(id, at, payload), update: (id, at, payload) => store.updateDecisionAudit(id, at, payload) });
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
  start(repository: string, project: TrackerProjectSnapshot, id: string): Promise<ProjectDrive> {
    return this.serialize(async () => {
      const existing = this.drives.find(drive => drive.id === id || drive.repository === repository && ["running", "paused"].includes(drive.status));
      if (existing) return existing;
      const repo = this.daemon.config.repos[repository];
      if (!repo || repo.tracker !== "linear" || repo.linearProject !== project.id) throw new ApiFailure(409, "conflict", "Project drive requires a configured Linear project");
      const now = new Date().toISOString();
      const drive: Drive = { id, repository, projectId: project.id, name: project.name, url: project.url, status: "running", createdAt: now, updatedAt: now, error: null, issues: [] };
      this.drives.push(drive);
      this.save(drive);
      await this.refresh(drive);
      return drive;
    });
  }
  control(id: string, action: "pause" | "resume" | "stop"): Promise<ProjectDrive> {
    return this.serialize(async () => {
      const drive = this.drives.find(one => one.id === id);
      if (!drive) throw new ApiFailure(404, "not_found", "Project drive not found");
      if (drive.status === "stopped" || drive.status === "finished") throw new ApiFailure(409, "conflict", "This drive has ended; start another from the home box");
      const { core } = this.intelligence();
      const decision = await core.decide({ decisionId: `drive-${id}-${randomUUID()}`, executionId: id, kind: "intake", question: "Apply the operator's explicit project drive control. Select the requested action.", state: { action, drive }, inputs: [{ name: "operator control", value: action }], candidates: [action, "hold"], criteria: { [action]: "The operator explicitly requested this control", hold: "The action is invalid for the current drive" } });
      if (!decision.applied || decision.choice !== action) throw new ApiFailure(409, "conflict", "Jev did not authorize this drive control");
      drive.status = action === "pause" ? "paused" : action === "stop" ? "stopped" : "running";
      this.save(drive);
      if (action === "stop") for (const issue of drive.issues) {
        const assignment = this.daemon.store.findAssignment(issue.issueId);
        if (assignment && ["queued", "running"].includes(assignment.status)) this.daemon.cancel(issue.issueId);
      }
      core.recordOutcome(decision.decisionId, { action, status: drive.status });
      if (action === "resume") await this.refresh(drive);
      return drive;
    });
  }
  reconcile(): Promise<void> {
    return this.serialize(async () => {
      for (const drive of this.drives) if (drive.status === "running") await this.refresh(drive);
    });
  }
  private async refresh(drive: Drive): Promise<void> {
    const before = JSON.stringify(drive);
    try {
      const client = this.daemon.trackerClient();
      if (!client?.getProject || !client.listProjectIssues) throw new Error("Linear project discovery is unavailable");
      const project = await client.getProject(drive.projectId);
      const issues = await client.listProjectIssues(drive.projectId);
      for (const issue of issues) if (repositoryKeyForIssue(issue, this.daemon.config) !== drive.repository) throw new Error("Project repository mapping changed; pause the drive and correct Settings");
      const milestones = new Map(project.milestones.map(milestone => [milestone.id, milestone]));
      issues.sort((a, b) => {
        const left = milestones.get(a.milestoneId ?? "");
        const right = milestones.get(b.milestoneId ?? "");
        return (a.priority || 5) - (b.priority || 5) || (left?.targetDate ?? "9999").localeCompare(right?.targetDate ?? "9999") || (left?.sortOrder ?? Infinity) - (right?.sortOrder ?? Infinity) || a.id.localeCompare(b.id);
      });
      for (const issue of issues) if (!drive.issues.some(entry => entry.issueId === issue.id)) drive.issues.push({ issueId: issue.id, key: issue.identifier ?? issue.id, title: issue.title, status: "pending", reason: null, retries: 0, admission: null });
      const { audit, core } = this.intelligence();
      const rows = new Map(issues.map(issue => [issue.id, issue]));
      for (const entry of drive.issues) {
        const issue = rows.get(entry.issueId);
        if (!issue) { entry.status = "held"; entry.reason = "Issue was removed from this project"; continue; }
        if (issue.stateType === "completed") { entry.status = "done"; entry.reason = null; continue; }
        if (issue.stateType === "canceled" || issue.stateType === "duplicate") { entry.status = "held"; entry.reason = "Issue is canceled or duplicate"; continue; }
        if (entry.admission !== null || entry.status === "held") continue;
        const full = await client.getIssue(issue.id);
        const existing = this.daemon.store.findAssignment(issue.id);
        if (existing?.manifest?.shipping && existing.manifest.verification?.passed) {
          const decisionId = `drive-${drive.id}-monitor-${issue.id}`;
          const decision = audit.get(decisionId) ? audit.replay(decisionId) : await core.decide({ decisionId, executionId: drive.id, kind: "intake", question: "This issue already has a verified Kor execution in publication or review. Monitor its existing shipping and merge gates to reach Done; do not ask for implementation readiness again or rerun verified work. Hold only if the original issue explicitly requires a server-side or owner-only check.", state: z.json().parse({ issue: { title: full.title, description: full.description ?? "", acceptanceCriteria: full.acceptanceCriteria, labels: full.labels }, execution: existing.executionId, stage: existing.manifest.shipping.stage.kind, verified: true }), inputs: [{ name: "existing verified execution", value: existing.executionId }], candidates: ["monitor", "hold"] });
          entry.admission = decisionId;
          entry.status = decision.applied && decision.choice === "monitor" ? "review" : "held";
          entry.reason = entry.status === "review" ? "Monitoring existing verified publication" : "Jev held the existing execution for operator review";
          core.recordOutcome(decisionId, { action: entry.status === "review" ? "monitor" : "hold", executionId: existing.executionId });
          continue;
        }
        const decisionId = `drive-${drive.id}-admit-${issue.id}`;
        const request: DecisionRequest = { decisionId, executionId: drive.id, kind: "intake", question: "Can Kor autonomously implement this existing issue? Read its description, acceptance, labels and comments. Hold work explicitly requiring server-side/live production checks, owner access, credentials or a human-only check. A normal repository check or local test is runnable. Do not implement held work. Missing essential scope or acceptance is held. Dependencies are enforced separately by the scheduler.", state: z.json().parse({ project, issue: full }), inputs: [{ name: "issue", value: issue.id }], candidates: ["ready", "server-check", "owner-check", "needs-input"], criteria: { ready: "Concrete coding work and local verification that Kor can perform", "server-check": "Explicitly requires server-side, production or deployed-environment validation", "owner-check": "Explicitly requires owner action, private access or human validation", "needs-input": "Missing essential specification or acceptance criteria" } };
        const decision = audit.get(decisionId) ? audit.replay(decisionId) : await core.decide(request);
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
        const entry = drive.issues.find(one => one.issueId === issue.id);
        if (!entry || entry.status === "done" || entry.status === "held") continue;
        const assignment = this.daemon.store.findAssignment(issue.id);
        const shipping = assignment?.manifest?.shipping;
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
      const progressing = drive.issues.some(entry => ["queued", "running", "review"].includes(entry.status));
      if (!progressing) for (const entry of drive.issues) if (entry.status === "pending") { entry.status = "held"; entry.reason = `No runnable path: ${entry.reason ?? "dependency cycle or external blocker"}`; }
      if (drive.issues.every(entry => entry.status === "done" || entry.status === "held")) drive.status = "finished";
      drive.error = null;
    } catch (error) {
      drive.error = error instanceof Error ? error.message.slice(0, 500) : "Project synchronization failed; will retry";
    }
    if (JSON.stringify(drive) !== before) this.save(drive);
  }
}
