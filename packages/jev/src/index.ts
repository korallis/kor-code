export * from "./contracts.js";
export * from "./client.js";
export * from "./redact.js";
export * from "./preflight.js";
export * from "./skills.js";
import { decideSkills, skillPlanSchema, type SkillPlan, type SkillsInput } from "./skills.js";
import type { CatalogueModel, DecisionBundle, DecisionInput, JsonValue, Route } from "@kor-code/core";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { answerSchema, type JevAnswer, type JevJsonValue, type JevQuestion, type JevResponse } from "./contracts.js";
import type { JevClient } from "./client.js";
import { redact } from "./redact.js";

export type DecisionKind = "route" | "skill" | "skills" | "agent" | "context" | "readiness" | "complexity" | "risk" | "acceptance" | "tools";
export type DecisionAnswerType = "choice" | "noul" | "score";
export interface AcceptanceJudgmentRequest {
  executionId: string;
  attempt?: number;
  attemptId?: string;
  state: JsonValue;
  criteria: readonly { id: string; description: string }[];
  threshold?: number;
}
export interface AcceptanceJudgment {
  criterionId: string;
  probability: number;
  passed: boolean;
}
export interface DecisionRequest { decisionId: string; executionId: string; kind: DecisionKind; question: string; state: JsonValue; inputs: DecisionInput[]; candidates: string[]; criteria?: Record<string, JevJsonValue>; nonApplyingCandidates?: string[]; answerType?: DecisionAnswerType; evidenceRefs?: string[]; policyChecks?: DecisionBundle["policyChecks"]; threshold?: number; overrides?: JsonValue }
export interface AppliedDecision extends DecisionBundle { plan?: SkillPlan; kind: DecisionKind; applied: boolean; escalated: boolean; answerType?: DecisionAnswerType; model?: string; probabilities?: Record<string, number>; noul?: number; score?: number; overrides?: JsonValue; observedOutcome?: JsonValue }
export interface DecisionAuditRecord { request: DecisionRequest; response: AppliedDecision; recordedAt: string; rawAnswer?: JevAnswer; overrides?: JsonValue; observedOutcome?: JsonValue }
export interface DecisionAuditLog { append(record: DecisionAuditRecord): void; get(decisionId: string): DecisionAuditRecord | undefined; explain(decisionId: string): DecisionAuditRecord; replay(decisionId: string): AppliedDecision; recordOutcome(decisionId: string, outcome: JsonValue): void }
export interface DecisionAuditPersistence { read(decisionId: string): string | undefined; write(decisionId: string, recordedAt: string, payload: string): void; update(decisionId: string, recordedAt: string, payload: string): void }

const jsonValue = z.json();
const policyCheckSchema = z.object({ name: z.string(), result: z.enum(["pass", "fail", "unresolved"]), reason: z.string().optional() });
const decisionRequestSchema = z.object({
  decisionId: z.string(), executionId: z.string(), kind: z.enum(["route", "skill", "skills", "agent", "context", "readiness", "complexity", "risk", "acceptance", "tools"]), question: z.string(), state: jsonValue,
  inputs: z.array(z.object({ name: z.string(), value: jsonValue, source: z.string().optional() })), candidates: z.array(z.string()), criteria: z.record(z.string(), jsonValue).optional(), nonApplyingCandidates: z.array(z.string()).optional(), answerType: z.enum(["choice", "noul", "score"]).optional(), evidenceRefs: z.array(z.string()).optional(),
  policyChecks: z.array(policyCheckSchema).optional(), threshold: z.number().optional(), overrides: jsonValue.optional(),
});
const appliedDecisionSchema = z.object({
  plan: skillPlanSchema.optional(),
  decisionId: z.string(), executionId: z.string(), question: z.string(), inputs: z.array(z.object({ name: z.string(), value: jsonValue, source: z.string().optional() })), choice: z.string(), candidates: z.array(z.string()), confidence: z.number(), reasons: z.array(z.string()), evidenceRefs: z.array(z.string()), policyChecks: z.array(policyCheckSchema), kind: z.enum(["route", "skill", "skills", "agent", "context", "readiness", "complexity", "risk", "acceptance", "tools"]), applied: z.boolean(), escalated: z.boolean(), answerType: z.enum(["choice", "noul", "score"]).optional(), model: z.string().optional(), probabilities: z.record(z.string(), z.number()).optional(), noul: z.number().optional(), score: z.number().optional(), overrides: jsonValue.optional(), observedOutcome: jsonValue.optional(),
});
const auditRecordSchema = z.object({ request: decisionRequestSchema, response: appliedDecisionSchema, recordedAt: z.string(), rawAnswer: answerSchema.optional(), overrides: jsonValue.optional(), observedOutcome: jsonValue.optional() });
function applyDecision(request: DecisionRequest, answer: JevAnswer | undefined, model?: string): AppliedDecision {
  const answerType = request.answerType ?? "choice";
  const choiceAnswer = answerType === "choice" && answer?.type === "choice" ? answer : undefined;
  const noulAnswer = answerType === "noul" && answer?.type === "noul" ? answer : undefined;
  const scoreAnswer = answerType === "score" && answer?.type === "score" ? answer : undefined;
  // Noul supplies probability of yes, not a separate confidence.
  const confidence = choiceAnswer?.confidence ?? scoreAnswer?.confidence ?? noulAnswer?.noul ?? 0;
  const threshold = request.threshold ?? 0.7;
  const validChoice = choiceAnswer !== undefined && request.candidates.includes(choiceAnswer.choice)
    || noulAnswer !== undefined && request.candidates.length === 2
    || scoreAnswer !== undefined && request.candidates.length >= 2 && scoreAnswer.score <= request.candidates.length - 1;
  const policyChecks = request.policyChecks ?? [];
  const policyBlocked = policyChecks.some(check => check.result === "fail");
  const nonApplyingChoice = choiceAnswer !== undefined && (request.nonApplyingCandidates ?? []).includes(choiceAnswer.choice);
  const escalated = policyBlocked || !validChoice || nonApplyingChoice || confidence < threshold;
  const choice = escalated && request.kind === "readiness" ? "blocked" : validChoice ? choiceAnswer?.choice ?? (noulAnswer ? (noulAnswer.noul >= 0.5 ? request.candidates[0]! : request.candidates[1]!) : request.candidates[Math.max(0, Math.min(request.candidates.length - 1, Math.round(scoreAnswer?.score ?? 0)))]!) : "escalate";
  return { decisionId: request.decisionId, executionId: request.executionId, question: request.question, inputs: request.inputs, choice, candidates: request.candidates, confidence, reasons: escalated ? policyBlocked ? policyChecks.filter(check => check.result === "fail").map(check => check.reason ?? `Policy check failed: ${check.name}.`) : [nonApplyingChoice ? "Jev selected a clarification instead of an executable candidate." : "Confidence or answer validity is below the configured threshold."] : ["Jev selected the highest-confidence candidate."], evidenceRefs: request.evidenceRefs ?? [], policyChecks, kind: request.kind, applied: !escalated, escalated, answerType, ...(choiceAnswer || scoreAnswer ? { probabilities: (choiceAnswer ?? scoreAnswer)!.probabilities } : {}), ...(noulAnswer ? { noul: noulAnswer.noul } : {}), ...(scoreAnswer ? { score: scoreAnswer.score } : {}), ...(request.overrides !== undefined ? { overrides: request.overrides } : {}), ...(model ? { model } : {}) };
}
export class MemoryDecisionAuditLog implements DecisionAuditLog {
  private readonly records = new Map<string, DecisionAuditRecord>();
  append(record: DecisionAuditRecord): void {
    if (this.records.has(record.response.decisionId)) throw new Error(`Decision audit record already exists: ${record.response.decisionId}`);
    this.records.set(record.response.decisionId, redact(structuredClone(record)) as DecisionAuditRecord);
  }
  get(decisionId: string): DecisionAuditRecord | undefined { const record = this.records.get(decisionId); return record ? structuredClone(record) : undefined; }
  explain(decisionId: string): DecisionAuditRecord { const record = this.get(decisionId); if (!record) throw new Error(`Decision not found: ${decisionId}`); return record; }
  replay(decisionId: string): AppliedDecision {
    const record = this.explain(decisionId);
    const replayed = record.rawAnswer ? applyDecision(record.request, record.rawAnswer, record.response.model) : record.response;
    return record.response.observedOutcome === undefined ? replayed : { ...replayed, observedOutcome: record.response.observedOutcome };
  }
  recordOutcome(decisionId: string, outcome: JsonValue): void {
    const record = this.records.get(decisionId);
    if (!record) throw new Error(`Decision not found: ${decisionId}`);
    const safeOutcome = redact(outcome) as JsonValue;
    record.observedOutcome = safeOutcome;
    record.response = { ...record.response, observedOutcome: safeOutcome };
  }
  export(): DecisionAuditRecord[] { return [...this.records.values()].map(record => structuredClone(record)); }
  serialize(): string { return JSON.stringify(this.export()); }
  import(records: readonly DecisionAuditRecord[]): void { for (const record of records) this.append(auditRecordSchema.parse(record) as DecisionAuditRecord); }
  importSerialized(serialized: string): void {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) throw new Error("Decision audit payload must be an array");
    this.import(parsed);
  }
}

/** Adds a durable storage boundary without coupling Jev to SQLite or Linear. */
export class PersistentDecisionAuditLog implements DecisionAuditLog {
  private readonly memory = new MemoryDecisionAuditLog();
  constructor(private readonly persistence: DecisionAuditPersistence) {}
  append(record: DecisionAuditRecord): void {
    const safe = redact(structuredClone(record)) as DecisionAuditRecord;
    this.persistence.write(safe.response.decisionId, safe.recordedAt, JSON.stringify(safe));
    this.memory.append(safe);
  }
  get(decisionId: string): DecisionAuditRecord | undefined {
    const inMemory = this.memory.get(decisionId);
    if (inMemory) return inMemory;
    const serialized = this.persistence.read(decisionId);
    if (!serialized) return undefined;
    const record = auditRecordSchema.parse(JSON.parse(serialized)) as DecisionAuditRecord;
    this.memory.append(record);
    return record;
  }
  explain(decisionId: string): DecisionAuditRecord { const record = this.get(decisionId); if (!record) throw new Error(`Decision not found: ${decisionId}`); return record; }
  replay(decisionId: string): AppliedDecision { const record = this.explain(decisionId); const replayed = record.rawAnswer ? applyDecision(record.request, record.rawAnswer, record.response.model) : record.response; return record.response.observedOutcome === undefined ? replayed : { ...replayed, observedOutcome: record.response.observedOutcome }; }
  recordOutcome(decisionId: string, outcome: JsonValue): void {
    const record = this.explain(decisionId);
    const safeOutcome = redact(outcome) as JsonValue;
    const updated = { ...record, observedOutcome: safeOutcome, response: { ...record.response, observedOutcome: safeOutcome } };
    this.persistence.update(decisionId, record.recordedAt, JSON.stringify(updated));
    this.memory.recordOutcome(decisionId, safeOutcome);
  }
}

export interface PreflightResult { decisions: AppliedDecision[]; response: JevResponse }
export class JevDecisionCore {
  constructor(private readonly client: Pick<JevClient, "evaluate">, private readonly audit: DecisionAuditLog = new MemoryDecisionAuditLog(), private readonly now: () => string = () => new Date().toISOString()) {}
  async preflight(requests: readonly DecisionRequest[]): Promise<PreflightResult> {
    if (requests.length === 0) return { decisions: [], response: { model: "none", answers: {} } };
    const ids = new Set<string>();
    for (const request of requests) { if (ids.has(request.decisionId)) throw new Error(`Duplicate decisionId: ${request.decisionId}`); ids.add(request.decisionId); }
    for (const request of requests) if (this.audit.get(request.decisionId) !== undefined) throw new Error(`Decision audit record already exists: ${request.decisionId}`);
    const state = requests.map(request => ({ decisionId: request.decisionId, kind: request.kind, state: request.state, inputs: request.inputs.map(input => ({ name: input.name, value: input.value, ...(input.source ? { source: input.source } : {}) })) }));
    const questions: Record<string, JevQuestion> = {};
    for (const request of requests) {
      const answerType = request.answerType ?? "choice";
      questions[request.decisionId] = answerType === "choice"
        ? { type: "choice", instructions: request.question, criteria: Object.fromEntries(request.candidates.map(candidate => [candidate, request.criteria?.[candidate] ?? null])) }
        : answerType === "noul"
          ? { type: "noul", instructions: request.question, criteria: { true: request.criteria?.true ?? request.candidates[0] ?? "true", false: request.criteria?.false ?? request.candidates[1] ?? "false" } }
          : { type: "score", instructions: request.question, criteria: request.candidates };
    }
    const response = await this.client.evaluate(state, questions);
    const decisions = requests.map(request => this.apply(request, response.answers[request.decisionId], response.model));
    return { decisions, response };
  }
  async decide(request: DecisionRequest): Promise<AppliedDecision> { return (await this.preflight([request])).decisions[0]!; }
  async selectRoute(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "route" }); }
  async selectSkills(input: SkillsInput): Promise<AppliedDecision & { plan: SkillPlan }> { return decideSkills(input, this.client, this.audit); }
  async selectSkill(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "skill" }); }
  async selectAgent(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "agent" }); }
  async rankContext(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "context" }); }
  /** Ask one typed Noul for each acceptance condition over the supplied evidence. */
  async judgeAcceptance(request: AcceptanceJudgmentRequest): Promise<AcceptanceJudgment[]> {
    if (request.criteria.length === 0) return [];
    const attemptId = request.attemptId ?? randomUUID();
    const threshold = request.threshold ?? 0.7;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Acceptance threshold must be between 0 and 1");
    const questions = Object.fromEntries(request.criteria.map(criterion => [criterion.id, {
      type: "noul" as const,
      instructions: `Does the current implementation satisfy this acceptance criterion: ${criterion.description}? Judge only the supplied diff, authoritative checks and actual tool results. A denied tool did not execute: do not treat its requested operation or the session's claims as evidence. Distinguish a denial that prevented required work from a harmless denied inspection or an operation subsequently demonstrated by permitted tools or authoritative checks.`,
      criteria: { true: "The diff, authoritative checks and actual non-denied tool outputs demonstrate the criterion is satisfied. A denied optional call alone does not invalidate this evidence.", false: "Required evidence is missing, contradictory or failing, including when a denied call prevented required work with no successful alternative demonstration." },
    }]));
    const response = await this.client.evaluate(request.state, questions);
    return request.criteria.map(criterion => {
      const answer = response.answers[criterion.id];
      if (!answer || answer.type !== "noul") throw new Error(`Jev acceptance answer missing for ${criterion.id}`);
      this.apply({ decisionId: `acceptance-${request.executionId}-${attemptId}-${criterion.id}`, executionId: request.executionId, kind: "acceptance", answerType: "noul", question: `Does the implementation satisfy: ${criterion.description}?`, state: request.state, inputs: [{ name: "attempt", value: request.attempt ?? 1 }, { name: "attemptId", value: attemptId }], candidates: ["yes", "no"], threshold }, answer, response.model);
      return { criterionId: criterion.id, probability: answer.noul, passed: answer.noul >= threshold };
    });
  }
  apply(request: DecisionRequest, answer: JevAnswer | undefined, model?: string): AppliedDecision {
    const result = applyDecision(request, answer, model);
    this.audit.append({ request: redact(structuredClone(request)) as DecisionRequest, response: result, recordedAt: this.now(), ...(answer ? { rawAnswer: structuredClone(answer) } : {}), ...(request.overrides !== undefined ? { overrides: redact(request.overrides) as JsonValue } : {}) });
    return result;
  }
  explain(decisionId: string): DecisionAuditRecord { return this.audit.explain(decisionId); }
  replay(decisionId: string): AppliedDecision { return this.audit.replay(decisionId); }
  recordOutcome(decisionId: string, outcome: JsonValue): void { this.audit.recordOutcome(decisionId, outcome); }
}
export function routeFromDecision(decision: AppliedDecision, catalogue: readonly CatalogueModel[], base: Omit<Route, "model" | "provider">): Route {
  if (!decision.applied || decision.escalated) throw new Error(`Cannot create a route from an unapplied decision: ${decision.decisionId}`);
  const model = catalogue.find(item => item.model === decision.choice && item.available !== false);
  if (!model) throw new Error(`Selected model is unavailable: ${decision.choice}`);
  return { ...base, model: model.model, provider: model.provider };
}
