import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { DecisionRecord, OverrideRecord } from "@kor-code/core";
import { z } from "zod";
import { SESSION_TARGETS, playbookPlanSchema, skillPlanSchema, type SkillPlan } from "@kor-code/jev";

type Row = Record<string, unknown>;

function decisionFrom(payload: string): DecisionRecord | undefined {
  try {
    const record = JSON.parse(payload) as { response?: Row; recordedAt?: unknown };
    const response = record.response;
    if (!response || typeof response.decisionId !== "string" || typeof response.executionId !== "string") return undefined;
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const probabilities = z.record(z.string(), z.number().min(0).max(1)).safeParse(response.probabilities);
    return {
      executionId: response.executionId,
      decisionId: response.decisionId,
      inputs: [],
      kind: typeof response.kind === "string" ? response.kind : "decision",
      question: typeof response.question === "string" ? response.question : "",
      choice: typeof response.choice === "string" ? response.choice : "",
      candidates: strings(response.candidates),
      confidence: typeof response.confidence === "number" ? response.confidence : 0,
      reasons: strings(response.reasons),
      evidenceRefs: strings(response.evidenceRefs),
      policyChecks: Array.isArray(response.policyChecks) ? response.policyChecks.filter((check): check is DecisionRecord["policyChecks"][number] => typeof check === "object" && check !== null && typeof (check as Row).name === "string") : [],
      escalated: response.escalated === true,
      recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : "",
      ...(probabilities.success ? { probabilities: probabilities.data } : {}),
    };
  } catch { return undefined; }
}

/**
 * The daemon's override audit, kept in `kor.db` beside the queue. Every
 * override the cockpit sends is recorded here, applied or rejected, with the
 * policy checks that decided it and whether its Linear comment was written.
 * Jev's own decision records (`decision_audit`, written by `kor plan` and the
 * controller) are read from the same file when that table exists.
 */
export class OverrideStore {
  private readonly db: DatabaseSync;
  constructor(file: string, private readonly now: () => number = Date.now) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS override_audit (
        id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, issue_id TEXT NOT NULL, target TEXT NOT NULL,
        choice TEXT NOT NULL, previous TEXT, status TEXT NOT NULL CHECK(status IN ('applied','rejected','reverted')),
        reason TEXT NOT NULL, policy_checks TEXT NOT NULL, origin TEXT NOT NULL, recorded_at TEXT NOT NULL,
        linear_comment TEXT NOT NULL, comment_id TEXT NOT NULL
      );`);
    if (!(this.db.prepare("PRAGMA table_info(override_audit)").all() as Row[]).some(column => column.name === "over_budget")) {
      this.db.exec("ALTER TABLE override_audit ADD COLUMN over_budget INTEGER NOT NULL DEFAULT 0");
    }
  }
  close(): void { this.db.close(); }

  record(input: Omit<OverrideRecord, "id" | "recordedAt" | "linearComment">): OverrideRecord & { commentId: string } {
    const record = { ...input, id: `ovr_${randomUUID().slice(0, 8)}`, recordedAt: new Date(this.now()).toISOString(), linearComment: input.status === "rejected" ? "skipped" as const : "pending" as const, commentId: randomUUID() };
    this.db.prepare("INSERT INTO override_audit(id,execution_id,issue_id,target,choice,previous,status,reason,policy_checks,origin,recorded_at,linear_comment,comment_id,over_budget) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(record.id, record.executionId, record.issueId, record.target, record.choice, record.previous ?? null, record.status, record.reason, JSON.stringify(record.policyChecks), record.origin, record.recordedAt, record.linearComment, record.commentId, record.overBudget ? 1 : 0);
    return record;
  }

  revert(id: string, reason: string): OverrideRecord | undefined {
    const changed = this.db.prepare("UPDATE override_audit SET status='reverted',reason=?,linear_comment='pending',comment_id=? WHERE id=? AND status='applied'").run(reason, randomUUID(), id).changes;
    return changed === 1 ? this.get(id) : undefined;
  }

  markComment(id: string, outcome: "written" | "failed"): void {
    this.db.prepare("UPDATE override_audit SET linear_comment=? WHERE id=?").run(outcome, id);
  }

  get(id: string): (OverrideRecord & { commentId: string }) | undefined {
    const row = this.db.prepare("SELECT * FROM override_audit WHERE id=?").get(id) as Row | undefined;
    return row ? this.parse(row) : undefined;
  }

  list(limit = 50): Array<OverrideRecord & { commentId: string }> {
    return (this.db.prepare("SELECT * FROM override_audit ORDER BY recorded_at DESC, rowid DESC LIMIT ?").all(limit) as Row[]).map(row => this.parse(row));
  }

  /** The route override in force for an execution: the latest applied one. */
  activeRoute(executionId: string): OverrideRecord | undefined { return this.activeDecision(executionId, "route"); }

  /** Read the current decision override without the snapshot's display limit. */
  activeDecision(executionId: string, target: string): OverrideRecord | undefined {
    const row = this.db.prepare("SELECT * FROM override_audit WHERE execution_id=? AND target=? AND status='applied' ORDER BY recorded_at DESC, rowid DESC LIMIT 1").get(executionId, target) as Row | undefined;
    return row ? this.parse(row) : undefined;
  }

  /** Skill, playbook and tool overrides for an execution in any status, oldest first. */
  sessionOverrides(executionId: string): Array<OverrideRecord & { commentId: string }> {
    return (this.db.prepare(`SELECT * FROM override_audit WHERE execution_id=? AND target IN (${SESSION_TARGETS.map(() => "?").join(",")}) ORDER BY recorded_at, rowid`).all(executionId, ...SESSION_TARGETS) as Row[]).map(row => this.parse(row));
  }

  pendingComments(): Array<OverrideRecord & { commentId: string }> {
    return (this.db.prepare("SELECT * FROM override_audit WHERE linear_comment IN ('pending','failed') ORDER BY rowid").all() as Row[]).map(row => this.parse(row));
  }

  /** Jev decisions for an execution, oldest first; empty until something records them. */
  decisions(executionId?: string): DecisionRecord[] {
    let rows: Row[];
    // `decision_audit` belongs to the queue store (`kor plan` and the daemon's preflight write it).
    try { rows = executionId ? this.db.prepare("SELECT payload FROM decision_audit WHERE instr(payload, ?) > 0 ORDER BY recorded_at").all(JSON.stringify(executionId)) as Row[]
      : this.db.prepare("SELECT payload FROM (SELECT payload,recorded_at FROM decision_audit ORDER BY recorded_at DESC, rowid DESC LIMIT 100) ORDER BY recorded_at").all() as Row[]; }
    catch { return []; }
    return rows.flatMap(row => {
      const decision = typeof row.payload === "string" ? decisionFrom(row.payload) : undefined;
      return decision && (!executionId || decision.executionId === executionId) ? [decision] : [];
    });
  }

  /** Jev's latest skills plan and playbook for an execution, before any override. */
  sessionPlan(executionId: string): { skills?: SkillPlan; playbook?: string | null } {
    let rows: Row[];
    try { rows = this.db.prepare("SELECT payload FROM decision_audit WHERE instr(payload, ?) > 0 ORDER BY recorded_at, rowid").all(JSON.stringify(executionId)) as Row[]; }
    catch { return {}; }
    const plan: { skills?: SkillPlan; playbook?: string | null } = {};
    for (const row of rows) {
      let payload: Row;
      try { payload = JSON.parse(String(row.payload)) as Row; } catch { continue; }
      const response = z.object({ executionId: z.literal(executionId), plan: skillPlanSchema.optional(), playbookPlan: playbookPlanSchema.optional() }).safeParse(payload.response);
      if (!response.success) continue;
      if (response.data.plan) plan.skills = response.data.plan;
      if (response.data.playbookPlan && response.data.playbookPlan.source !== "override") plan.playbook = response.data.playbookPlan.selected;
    }
    return plan;
  }

  private parse(row: Row): OverrideRecord & { commentId: string } {
    return {
      id: String(row.id), executionId: String(row.execution_id), issueId: String(row.issue_id), target: String(row.target), choice: String(row.choice),
      ...(typeof row.previous === "string" ? { previous: row.previous } : {}),
      ...(row.over_budget === 1 ? { overBudget: true as const } : {}),
      status: row.status as OverrideRecord["status"], reason: String(row.reason), policyChecks: JSON.parse(String(row.policy_checks)) as OverrideRecord["policyChecks"],
      origin: String(row.origin), recordedAt: String(row.recorded_at), linearComment: row.linear_comment as OverrideRecord["linearComment"], commentId: String(row.comment_id),
    };
  }
}
