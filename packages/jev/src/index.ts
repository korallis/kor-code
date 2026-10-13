export * from "./contracts.js";
export * from "./client.js";
export * from "./redact.js";
import type { CatalogueModel, DecisionBundle, DecisionInput, JsonValue, Route } from "@kor-code/core";
import type { JevAnswer, JevQuestion, JevResponse } from "./contracts.js";
import type { JevClient } from "./client.js";

export type DecisionKind = "route" | "skill" | "agent" | "context";
export interface DecisionRequest { decisionId: string; executionId: string; kind: DecisionKind; question: string; state: JsonValue; inputs: DecisionInput[]; candidates: string[]; evidenceRefs?: string[]; policyChecks?: DecisionBundle["policyChecks"]; threshold?: number }
export interface AppliedDecision extends DecisionBundle { kind: DecisionKind; applied: boolean; escalated: boolean; model?: string }
export interface DecisionAuditRecord { request: DecisionRequest; response: AppliedDecision; recordedAt: string }
export interface DecisionAuditLog { append(record: DecisionAuditRecord): void; get(decisionId: string): DecisionAuditRecord | undefined; explain(decisionId: string): DecisionAuditRecord; replay(decisionId: string): AppliedDecision }
export class MemoryDecisionAuditLog implements DecisionAuditLog {
  private readonly records = new Map<string, DecisionAuditRecord>();
  append(record: DecisionAuditRecord): void { this.records.set(record.response.decisionId, structuredClone(record)); }
  get(decisionId: string): DecisionAuditRecord | undefined { const record = this.records.get(decisionId); return record ? structuredClone(record) : undefined; }
  explain(decisionId: string): DecisionAuditRecord { const record = this.get(decisionId); if (!record) throw new Error(`Decision not found: ${decisionId}`); return record; }
  replay(decisionId: string): AppliedDecision { return this.explain(decisionId).response; }
  export(): DecisionAuditRecord[] { return [...this.records.values()].map(record => structuredClone(record)); }
  serialize(): string { return JSON.stringify(this.export()); }
  import(records: readonly DecisionAuditRecord[]): void { for (const record of records) this.append(record); }
  importSerialized(serialized: string): void {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) throw new Error("Decision audit payload must be an array");
    this.import(parsed as DecisionAuditRecord[]);
  }
}

export interface PreflightResult { decisions: AppliedDecision[]; response: JevResponse }
export class JevDecisionCore {
  constructor(private readonly client: Pick<JevClient, "evaluate">, private readonly audit: DecisionAuditLog = new MemoryDecisionAuditLog(), private readonly now: () => string = () => new Date().toISOString()) {}
  async preflight(requests: readonly DecisionRequest[]): Promise<PreflightResult> {
    if (requests.length === 0) return { decisions: [], response: { model: "none", answers: {} } };
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
  apply(request: DecisionRequest, answer: JevAnswer | undefined, model?: string): AppliedDecision {
    const choiceAnswer = answer?.type === "choice" ? answer : undefined;
    const confidence = choiceAnswer?.confidence ?? 0;
    const threshold = request.threshold ?? 0.7;
    const validChoice = choiceAnswer !== undefined && request.candidates.includes(choiceAnswer.choice);
    const policyChecks = request.policyChecks ?? [];
    const policyBlocked = policyChecks.some(check => check.result === "fail");
    const escalated = policyBlocked || !validChoice || confidence < threshold;
    const choice = validChoice ? choiceAnswer.choice : "escalate";
    const result: AppliedDecision = { decisionId: request.decisionId, executionId: request.executionId, question: request.question, inputs: request.inputs, choice, candidates: request.candidates, confidence, reasons: escalated ? [policyBlocked ? "A policy check failed." : "Confidence or answer validity is below the configured threshold."] : ["Jev selected the highest-confidence candidate."], evidenceRefs: request.evidenceRefs ?? [], policyChecks, kind: request.kind, applied: !escalated, escalated, ...(model ? { model } : {}) };
    this.audit.append({ request: structuredClone(request), response: result, recordedAt: this.now() });
    return result;
  }
  explain(decisionId: string): DecisionAuditRecord { return this.audit.explain(decisionId); }
  replay(decisionId: string): AppliedDecision { return this.audit.replay(decisionId); }
}
export function routeFromDecision(decision: AppliedDecision, catalogue: readonly CatalogueModel[], base: Omit<Route, "model" | "provider">): Route {
  const model = catalogue.find(item => item.model === decision.choice && item.available !== false);
  if (!model) throw new Error(`Selected model is unavailable: ${decision.choice}`);
  return { ...base, model: model.model, provider: model.provider };
}
