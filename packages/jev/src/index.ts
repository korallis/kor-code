export * from "./contracts.js";
export * from "./client.js";
export * from "./redact.js";
import type { CatalogueModel, DecisionBundle, DecisionInput, JsonValue, Route } from "@kor-code/core";
import { z } from "zod";
import { answerSchema, type JevAnswer, type JevQuestion, type JevResponse } from "./contracts.js";
import type { JevClient } from "./client.js";
import { redact } from "./redact.js";

export type DecisionKind = "route" | "skill" | "agent" | "context" | "acceptance";
export interface AcceptanceJudgmentRequest {
  executionId: string;
  attempt?: number;
  state: JsonValue;
  criteria: readonly { id: string; description: string }[];
  threshold?: number;
}
export interface AcceptanceJudgment {
  criterionId: string;
  probability: number;
  passed: boolean;
}
export interface DecisionRequest { decisionId: string; executionId: string; kind: DecisionKind; question: string; state: JsonValue; inputs: DecisionInput[]; candidates: string[]; evidenceRefs?: string[]; policyChecks?: DecisionBundle["policyChecks"]; threshold?: number; overrides?: JsonValue }
export interface AppliedDecision extends DecisionBundle { kind: DecisionKind; applied: boolean; escalated: boolean; model?: string; probabilities?: Record<string, number>; overrides?: JsonValue; observedOutcome?: JsonValue }
export interface DecisionAuditRecord { request: DecisionRequest; response: AppliedDecision; recordedAt: string; rawAnswer?: JevAnswer; overrides?: JsonValue; observedOutcome?: JsonValue }
export interface DecisionAuditLog { append(record: DecisionAuditRecord): void; get(decisionId: string): DecisionAuditRecord | undefined; explain(decisionId: string): DecisionAuditRecord; replay(decisionId: string): AppliedDecision; recordOutcome(decisionId: string, outcome: JsonValue): void }

const jsonValue = z.json();
const policyCheckSchema = z.object({ name: z.string(), result: z.enum(["pass", "fail", "unresolved"]) });
const decisionRequestSchema = z.object({
  decisionId: z.string(), executionId: z.string(), kind: z.enum(["route", "skill", "agent", "context", "acceptance"]), question: z.string(), state: jsonValue,
  inputs: z.array(z.object({ name: z.string(), value: jsonValue, source: z.string().optional() })), candidates: z.array(z.string()), evidenceRefs: z.array(z.string()).optional(),
  policyChecks: z.array(policyCheckSchema).optional(), threshold: z.number().optional(), overrides: jsonValue.optional(),
});
const appliedDecisionSchema = z.object({
  decisionId: z.string(), executionId: z.string(), question: z.string(), inputs: z.array(z.object({ name: z.string(), value: jsonValue, source: z.string().optional() })), choice: z.string(), candidates: z.array(z.string()), confidence: z.number(), reasons: z.array(z.string()), evidenceRefs: z.array(z.string()), policyChecks: z.array(policyCheckSchema), kind: z.enum(["route", "skill", "agent", "context", "acceptance"]), applied: z.boolean(), escalated: z.boolean(), model: z.string().optional(), probabilities: z.record(z.string(), z.number()).optional(), overrides: jsonValue.optional(), observedOutcome: jsonValue.optional(),
});
const auditRecordSchema = z.object({ request: decisionRequestSchema, response: appliedDecisionSchema, recordedAt: z.string(), rawAnswer: answerSchema.optional(), overrides: jsonValue.optional(), observedOutcome: jsonValue.optional() });
function applyDecision(request: DecisionRequest, answer: JevAnswer | undefined, model?: string): AppliedDecision {
  if (request.kind === "acceptance" && answer?.type === "noul") {
    const applied = answer.noul >= (request.threshold ?? 0.7);
    return { decisionId: request.decisionId, executionId: request.executionId, question: request.question, inputs: request.inputs, choice: answer.noul >= 0.5 ? "yes" : "no", candidates: request.candidates, confidence: answer.noul, reasons: ["Acceptance Noul probability of yes."], evidenceRefs: request.evidenceRefs ?? [], policyChecks: request.policyChecks ?? [], kind: request.kind, applied, escalated: !applied, ...(model ? { model } : {}) };
  }
  const choiceAnswer = answer?.type === "choice" ? answer : undefined;
  const confidence = choiceAnswer?.confidence ?? 0;
  const threshold = request.threshold ?? 0.7;
  const validChoice = choiceAnswer !== undefined && request.candidates.includes(choiceAnswer.choice);
  const policyChecks = request.policyChecks ?? [];
  const policyBlocked = policyChecks.some(check => check.result === "fail");
  const escalated = policyBlocked || !validChoice || confidence < threshold;
  const choice = validChoice ? choiceAnswer.choice : "escalate";
  return { decisionId: request.decisionId, executionId: request.executionId, question: request.question, inputs: request.inputs, choice, candidates: request.candidates, confidence, reasons: escalated ? [policyBlocked ? "A policy check failed." : "Confidence or answer validity is below the configured threshold."] : ["Jev selected the highest-confidence candidate."], evidenceRefs: request.evidenceRefs ?? [], policyChecks, kind: request.kind, applied: !escalated, escalated, ...(choiceAnswer ? { probabilities: choiceAnswer.probabilities } : {}), ...(request.overrides !== undefined ? { overrides: request.overrides } : {}), ...(model ? { model } : {}) };
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
    const replayed = applyDecision(record.request, record.rawAnswer, record.response.model);
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
    for (const request of requests) questions[request.decisionId] = { type: "choice", instructions: request.question, criteria: Object.fromEntries(request.candidates.map(candidate => [candidate, null])) };
    const response = await this.client.evaluate(state, questions);
    const decisions = requests.map(request => this.apply(request, response.answers[request.decisionId], response.model));
    return { decisions, response };
  }
  async decide(request: DecisionRequest): Promise<AppliedDecision> { return (await this.preflight([request])).decisions[0]!; }
  async selectRoute(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "route" }); }
  async selectSkill(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "skill" }); }
  async selectAgent(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "agent" }); }
  async rankContext(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "context" }); }
  /** Ask one typed Noul for each acceptance condition over the supplied evidence. */
  async judgeAcceptance(request: AcceptanceJudgmentRequest): Promise<AcceptanceJudgment[]> {
    if (request.criteria.length === 0) return [];
    const threshold = request.threshold ?? 0.7;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Acceptance threshold must be between 0 and 1");
    const questions = Object.fromEntries(request.criteria.map(criterion => [criterion.id, {
      type: "noul" as const,
      instructions: `Does the current implementation satisfy this acceptance criterion: ${criterion.description}? Judge only the supplied diff and check output.`,
      criteria: { true: "The diff and authoritative checks demonstrate the criterion is satisfied.", false: "The evidence is missing, contradictory, or the checks do not demonstrate the criterion." },
    }]));
    const response = await this.client.evaluate(request.state, questions);
    return request.criteria.map(criterion => {
      const answer = response.answers[criterion.id];
      if (!answer || answer.type !== "noul") throw new Error(`Jev acceptance answer missing for ${criterion.id}`);
      this.apply({ decisionId: `acceptance-${request.executionId}-${request.attempt ?? 1}-${criterion.id}`, executionId: request.executionId, kind: "acceptance", question: `Does the implementation satisfy: ${criterion.description}?`, state: request.state, inputs: [{ name: "attempt", value: request.attempt ?? 1 }], candidates: ["yes", "no"], threshold }, answer, response.model);
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
