import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { JsonValue } from "@kor-code/core";
import { MemoryDecisionAuditLog, redact, type AppliedDecision, type DecisionAuditLog, type DecisionAuditRecord } from "@kor-code/jev";
import { turnSchema, loadEventSchema } from "./context.js";

const count = z.number().int().nonnegative();
const measurement = z.number().nonnegative().nullable();
const route = z.object({ provider: z.string(), model: z.string(), accountPolicy: z.enum(["fill-first", "manual", "least-used"]), sessionAffinity: z.boolean(), reasoningLevel: z.enum(["low", "medium", "high"]).optional(), label: z.enum(["jev", "fallback", "escalated"]).optional(), decisionId: z.string().optional() });
export const runSchema = z.object({
  purpose: z.enum(["route", "skills"]).optional(), executionId: z.string(), pairId: z.string(), issueId: z.string(), arm: z.enum(["jev", "baseline", "fallback"]),
  baseRevision: z.string(), route, sampled: z.boolean(), startedAt: z.string().datetime(),
  status: z.enum(["running", "verified", "failed", "interrupted", "escalated"]), finishedAt: z.string().datetime().optional(),
});
export type CalibrationRun = z.infer<typeof runSchema>;
export const metricSchema = z.object({
  executionId: z.string(), attempt: count.positive(), attemptId: z.string().uuid().optional(), recordedAt: z.string().datetime(),
  skillDecisionId: z.string().optional(), tools: z.array(z.string()).nullable().default(null),
  decisionId: z.string().optional(), model: z.string(), costUsd: measurement,
  inputTokens: measurement, outputTokens: measurement, cacheReadTokens: measurement, cacheCreationTokens: measurement,
  startContextTokens: measurement.default(null), contextTokenSum: measurement.default(null),
  turns: z.array(turnSchema).nullable().default(null), loadEvents: z.array(loadEventSchema).nullable().default(null),
  wallClockMs: z.number().nonnegative(), sessionDurationMs: measurement,
  failovers: measurement, apiErrorStatus: z.number().nullable(), policyBlocks: measurement, clarifications: measurement,
  verificationFailures: count, verified: z.boolean(),
  findings: z.array(z.object({ conditionId: z.string(), status: z.enum(["pending", "pass", "fail", "unresolved"]), evidenceIds: z.array(z.string()), note: z.string().optional() })),
});
export type RunMetric = z.infer<typeof metricSchema>;
export const outcomeSchema = z.object({ status: z.enum(["merged", "rejected", "escalated", "abandoned"]), recordedAt: z.string().datetime(), source: z.string().min(1) });
export type RunOutcome = z.infer<typeof outcomeSchema>;
const storedOutcome = outcomeSchema.extend({ executionId: z.string() });
const payloadRow = z.object({ payload: z.string() });

/** Stable across restarts and independent of route, outcome and issue difficulty. */
export function sampledPair(executionId: string, rate: number): boolean {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("Calibration sample rate must be between 0 and 1");
  return createHash("sha256").update(`kor-calibration-v1:${executionId}`).digest().readUInt32BE(0) / 0x1_0000_0000 < rate;
}

/** Additive tables in T7's database; WAL allows the queue and report to coexist. */
export class CalibrationStore implements DecisionAuditLog {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS calibration_runs (execution_id TEXT PRIMARY KEY, pair_id TEXT NOT NULL, arm TEXT NOT NULL, started_at TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(pair_id, arm));
      CREATE TABLE IF NOT EXISTS run_metrics (execution_id TEXT NOT NULL, attempt INTEGER NOT NULL, recorded_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(execution_id, attempt));
      CREATE TABLE IF NOT EXISTS run_outcomes (execution_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decision_audit (decision_id TEXT PRIMARY KEY, recorded_at TEXT NOT NULL, payload TEXT NOT NULL);`);
    this.transaction(() => {
      const columns = this.db.prepare("PRAGMA table_info(run_metrics)").all().map(row => z.object({ name: z.string() }).parse(row).name);
      for (const { name, type } of [{ name: "start_context_tokens", type: "INTEGER" }, { name: "context_token_sum", type: "INTEGER" }, { name: "turns_json", type: "TEXT" }, { name: "load_events_json", type: "TEXT" }]) {
        if (!columns.includes(name)) this.db.exec(`ALTER TABLE run_metrics ADD COLUMN ${name} ${type}`);
      }
    });
  }
  close(): void { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /** False means a previous dispatch already reserved this arm. Never replay twice. */
  beginRun(input: CalibrationRun): boolean {
    const run = runSchema.parse(input);
    return this.db.prepare("INSERT OR IGNORE INTO calibration_runs VALUES(?,?,?,?,?)").run(run.executionId, run.pairId, run.arm, run.startedAt, JSON.stringify(run)).changes === 1;
  }
  run(executionId: string): CalibrationRun | undefined {
    const row = this.db.prepare("SELECT payload FROM calibration_runs WHERE execution_id=?").get(executionId);
    return row ? runSchema.parse(JSON.parse(payloadRow.parse(row).payload)) : undefined;
  }
  finishRun(executionId: string, status: Exclude<CalibrationRun["status"], "running">): void {
    const run = this.run(executionId);
    if (!run) throw new Error("Calibration run is missing");
    this.db.prepare("UPDATE calibration_runs SET payload=? WHERE execution_id=?").run(JSON.stringify({ ...run, status, finishedAt: new Date().toISOString() }), executionId);
  }
  /** Re-open an interrupted or failed primary when the daemon retries its execution id. */
  resumeRun(executionId: string, startedAt = new Date().toISOString(), route?: CalibrationRun["route"]): void {
    const run = this.run(executionId);
    if (!run || run.status === "running") return;
    const currentRoute = route ?? run.route;
    const arm = run.arm === "baseline" ? "baseline" : currentRoute.label === "jev" ? "jev" : "fallback";
    this.transaction(() => {
      this.db.prepare("UPDATE calibration_runs SET arm=?, started_at=?, payload=? WHERE execution_id=?").run(arm, startedAt, JSON.stringify({ ...run, route: currentRoute, arm, sampled: arm !== "fallback" && run.sampled, status: "running", startedAt, finishedAt: undefined }), executionId);
      // A retried execution is no longer terminal. Keep attempt history, but do
      // not score the new attempt against the previous abandoned/rejected state.
      this.db.prepare("DELETE FROM run_outcomes WHERE execution_id=?").run(executionId);
      for (const record of this.decisions().filter(item => item.response.executionId === executionId)) {
        const { observedOutcome: _, response, ...rest } = record;
        const { observedOutcome: __, ...decision } = response;
        this.db.prepare("UPDATE decision_audit SET payload=? WHERE decision_id=?").run(JSON.stringify({ ...rest, response: decision }), decision.decisionId);
      }
    });
  }
  recordAttempt(input: z.input<typeof metricSchema>): void {
    const metric = metricSchema.parse(input);
    if (!this.run(metric.executionId)) throw new Error("Attempt requires a calibration run");
    // Conflicting attempts must not silently replace measured costs after a restart.
    this.db.prepare("INSERT INTO run_metrics (execution_id, attempt, recorded_at, payload, start_context_tokens, context_token_sum, turns_json, load_events_json) VALUES(?,?,?,?,?,?,?,?)")
      .run(metric.executionId, metric.attempt, metric.recordedAt, JSON.stringify(redact(metric)), metric.startContextTokens, metric.contextTokenSum,
        metric.turns === null ? null : JSON.stringify(metric.turns), metric.loadEvents === null ? null : JSON.stringify(redact(metric.loadEvents)));
  }
  nextAttempt(executionId: string): number {
    const row = z.object({ attempt: count }).parse(this.db.prepare("SELECT COALESCE(MAX(attempt),0) AS attempt FROM run_metrics WHERE execution_id=?").get(executionId));
    return row.attempt + 1;
  }
  runs(): CalibrationRun[] { return this.db.prepare("SELECT payload FROM calibration_runs ORDER BY started_at, execution_id").all().map(row => runSchema.parse(JSON.parse(payloadRow.parse(row).payload))); }
  metrics(): RunMetric[] { return this.db.prepare("SELECT payload FROM run_metrics ORDER BY execution_id, attempt").all().map(row => metricSchema.parse(JSON.parse(payloadRow.parse(row).payload))); }
  outcomes(): z.infer<typeof storedOutcome>[] { return this.db.prepare("SELECT execution_id, payload FROM run_outcomes").all().map(row => storedOutcome.parse({ ...JSON.parse(payloadRow.parse(row).payload), executionId: row.execution_id })); }
  recordExecutionOutcome(executionId: string, input: RunOutcome): void {
    const outcome = outcomeSchema.parse(input);
    if (!this.run(executionId)) throw new Error("Outcome requires a recorded execution");
    this.transaction(() => {
      this.db.prepare("INSERT INTO run_outcomes VALUES(?,?) ON CONFLICT(execution_id) DO UPDATE SET payload=excluded.payload").run(executionId, JSON.stringify(outcome));
      for (const record of this.decisions().filter(item => item.response.executionId === executionId)) {
        this.recordOutcome(record.response.decisionId, { ...outcome, success: outcome.status === "merged" });
      }
    });
  }
  append(record: DecisionAuditRecord): void {
    const memory = new MemoryDecisionAuditLog();
    memory.import([record]);
    const safe = memory.explain(record.response.decisionId);
    this.db.prepare("INSERT INTO decision_audit VALUES(?,?,?)").run(safe.response.decisionId, safe.recordedAt, JSON.stringify(safe));
  }
  get(decisionId: string): DecisionAuditRecord | undefined {
    const row = this.db.prepare("SELECT payload FROM decision_audit WHERE decision_id=?").get(decisionId);
    if (!row) return undefined;
    const memory = new MemoryDecisionAuditLog();
    memory.importSerialized(`[${payloadRow.parse(row).payload}]`);
    return memory.explain(decisionId);
  }
  decisions(): DecisionAuditRecord[] {
    const memory = new MemoryDecisionAuditLog();
    memory.importSerialized(`[${this.db.prepare("SELECT payload FROM decision_audit ORDER BY recorded_at").all().map(row => payloadRow.parse(row).payload).join(",")}]`);
    return memory.export();
  }
  explain(decisionId: string): DecisionAuditRecord { const record = this.get(decisionId); if (!record) throw new Error(`Decision not found: ${decisionId}`); return record; }
  replay(decisionId: string): AppliedDecision { const memory = new MemoryDecisionAuditLog(); memory.import([this.explain(decisionId)]); return memory.replay(decisionId); }
  recordOutcome(decisionId: string, outcome: JsonValue): void {
    const record = this.explain(decisionId);
    const safe = redact(outcome);
    this.db.prepare("UPDATE decision_audit SET payload=? WHERE decision_id=?").run(JSON.stringify({ ...record, observedOutcome: safe, response: { ...record.response, observedOutcome: safe } }), decisionId);
  }
}
