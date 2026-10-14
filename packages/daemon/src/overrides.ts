import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { DecisionRecord, OverrideRecord } from "@kor-code/core";

type Row = Record<string, unknown>;

function decisionFrom(payload: string): DecisionRecord | undefined {
  try {
    const record = JSON.parse(payload) as { response?: Row; recordedAt?: unknown };
    const response = record.response;
    if (!response || typeof response.decisionId !== "string" || typeof response.executionId !== "string") return undefined;
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
  }
  close(): void { this.db.close(); }

  record(input: Omit<OverrideRecord, "id" | "recordedAt" | "linearComment">): OverrideRecord & { commentId: string } {
    const record = { ...input, id: `ovr_${randomUUID().slice(0, 8)}`, recordedAt: new Date(this.now()).toISOString(), linearComment: input.status === "rejected" ? "skipped" as const : "pending" as const, commentId: randomUUID() };
    this.db.prepare("INSERT INTO override_audit(id,execution_id,issue_id,target,choice,previous,status,reason,policy_checks,origin,recorded_at,linear_comment,comment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(record.id, record.executionId, record.issueId, record.target, record.choice, record.previous ?? null, record.status, record.reason, JSON.stringify(record.policyChecks), record.origin, record.recordedAt, record.linearComment, record.commentId);
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
  activeRoute(executionId: string): OverrideRecord | undefined {
    const row = this.db.prepare("SELECT * FROM override_audit WHERE execution_id=? AND target='route' AND status='applied' ORDER BY recorded_at DESC, rowid DESC LIMIT 1").get(executionId) as Row | undefined;
    return row ? this.parse(row) : undefined;
  }

  pendingComments(): Array<OverrideRecord & { commentId: string }> {
    return (this.db.prepare("SELECT * FROM override_audit WHERE linear_comment IN ('pending','failed') ORDER BY rowid").all() as Row[]).map(row => this.parse(row));
  }

  /** Jev decisions for an execution, oldest first; empty until something records them. */
  decisions(executionId: string): DecisionRecord[] {
    let rows: Row[];
    // `decision_audit` belongs to the queue store (`kor plan` and the daemon's preflight write it).
    try { rows = this.db.prepare("SELECT payload FROM decision_audit WHERE instr(payload, ?) > 0 ORDER BY recorded_at").all(JSON.stringify(executionId)) as Row[]; }
    catch { return []; }
    return rows.flatMap(row => {
      const decision = typeof row.payload === "string" ? decisionFrom(row.payload) : undefined;
      return decision && decision.executionId === executionId ? [decision] : [];
    });
  }

  private parse(row: Row): OverrideRecord & { commentId: string } {
    return {
      id: String(row.id), executionId: String(row.execution_id), issueId: String(row.issue_id), target: String(row.target), choice: String(row.choice),
      ...(typeof row.previous === "string" ? { previous: row.previous } : {}),
      status: row.status as OverrideRecord["status"], reason: String(row.reason), policyChecks: JSON.parse(String(row.policy_checks)) as OverrideRecord["policyChecks"],
      origin: String(row.origin), recordedAt: String(row.recorded_at), linearComment: row.linear_comment as OverrideRecord["linearComment"], commentId: String(row.comment_id),
    };
  }
}
