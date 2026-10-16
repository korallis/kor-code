export * from "./contracts.js";
export * from "./client.js";
export * from "./redact.js";
export * from "./preflight.js";
import { planPreflight, type PreflightInput, type PreflightPlan } from "./preflight.js";
export * from "./routing.js";
export * from "./skills.js";
export * from "./playbooks.js";
export * from "./session-overrides.js";
import { decidePlaybook, playbookPlanSchema, type PlaybookInput, type PlaybookPlan } from "./playbooks.js";
import { decideSkills, skillPlanSchema, type SkillPlan, type SkillsInput } from "./skills.js";
import type { CatalogueModel, DecisionBundle, DecisionInput, JsonValue, Route } from "@kor-code/core";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { answerSchema, type JevAnswer, type JevJsonValue, type JevQuestion, type JevResponse } from "./contracts.js";
import { JevUnavailableError, type JevClient } from "./client.js";
import { redact } from "./redact.js";

export type DecisionKind = "route" | "skill" | "skills" | "playbook" | "agent" | "context" | "readiness" | "reasoning-class" | "complexity" | "risk" | "acceptance" | "tools" | "review-route" | "merge" | "intake";
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
export interface DecisionRequest { decisionId: string; executionId: string; kind: DecisionKind; question: string; state: JsonValue; inputs: DecisionInput[]; candidates: string[]; criteria?: Record<string, JevJsonValue>; nonApplyingCandidates?: string[]; answerType?: DecisionAnswerType; noulPolicy?: "scope-veto" | "two-sided"; evidenceRefs?: string[]; policyChecks?: DecisionBundle["policyChecks"]; threshold?: number; overrides?: JsonValue }
export interface AppliedDecision extends DecisionBundle { plan?: SkillPlan; playbookPlan?: PlaybookPlan; kind: DecisionKind; applied: boolean; escalated: boolean; answerType?: DecisionAnswerType; model?: string; probabilities?: Record<string, number>; noul?: number; score?: number; overrides?: JsonValue; observedOutcome?: JsonValue }
export interface DecisionAuditRecord { request: DecisionRequest; response: AppliedDecision; recordedAt: string; rawAnswer?: JevAnswer; overrides?: JsonValue; observedOutcome?: JsonValue }
export interface DecisionAuditLog { append(record: DecisionAuditRecord): void; get(decisionId: string): DecisionAuditRecord | undefined; explain(decisionId: string): DecisionAuditRecord; replay(decisionId: string): AppliedDecision; recordOutcome(decisionId: string, outcome: JsonValue): void }
export interface DecisionAuditPersistence { read(decisionId: string): string | undefined; write(decisionId: string, recordedAt: string, payload: string): void; update(decisionId: string, recordedAt: string, payload: string): void }

const jsonValue = z.json();
const policyCheckSchema = z.object({ name: z.string(), result: z.enum(["pass", "fail", "unresolved"]), reason: z.string().optional() });
const decisionRequestSchema = z.object({
  decisionId: z.string(), executionId: z.string(), kind: z.enum(["route", "skill", "skills", "playbook", "agent", "context", "readiness", "reasoning-class", "complexity", "risk", "acceptance", "tools", "review-route", "merge", "intake"]), question: z.string(), state: jsonValue,
  inputs: z.array(z.object({ name: z.string(), value: jsonValue, source: z.string().optional() })), candidates: z.array(z.string()), criteria: z.record(z.string(), jsonValue).optional(), nonApplyingCandidates: z.array(z.string()).optional(), noulPolicy: z.enum(["scope-veto", "two-sided"]).optional(), answerType: z.enum(["choice", "noul", "score"]).optional(), evidenceRefs: z.array(z.string()).optional(),
  policyChecks: z.array(policyCheckSchema).optional(), threshold: z.number().optional(), overrides: jsonValue.optional(),
});
const appliedDecisionSchema = z.object({
  plan: skillPlanSchema.optional(), playbookPlan: playbookPlanSchema.optional(),
  decisionId: z.string(), executionId: z.string(), question: z.string(), inputs: z.array(z.object({ name: z.string(), value: jsonValue, source: z.string().optional() })), choice: z.string(), candidates: z.array(z.string()), confidence: z.number(), reasons: z.array(z.string()), evidenceRefs: z.array(z.string()), policyChecks: z.array(policyCheckSchema), kind: z.enum(["route", "skill", "skills", "playbook", "agent", "context", "readiness", "reasoning-class", "complexity", "risk", "acceptance", "tools", "review-route", "merge", "intake"]), applied: z.boolean(), escalated: z.boolean(), answerType: z.enum(["choice", "noul", "score"]).optional(), model: z.string().optional(), probabilities: z.record(z.string(), z.number()).optional(), noul: z.number().optional(), score: z.number().optional(), overrides: jsonValue.optional(), observedOutcome: jsonValue.optional(),
});
const auditRecordSchema = z.object({ request: decisionRequestSchema, response: appliedDecisionSchema, recordedAt: z.string(), rawAnswer: answerSchema.optional(), overrides: jsonValue.optional(), observedOutcome: jsonValue.optional() });
function applyDecision(request: DecisionRequest, answer: JevAnswer | undefined, model?: string): AppliedDecision {
  const answerType = request.answerType ?? "choice";
  const choiceAnswer = answerType === "choice" && answer?.type === "choice" ? answer : undefined;
  const noulAnswer = answerType === "noul" && answer?.type === "noul" ? answer : undefined;
  const scoreAnswer = answerType === "score" && answer?.type === "score" ? answer : undefined;
  // Noul has no provider confidence. Tools use probability of the selected side;
  // acceptance/merge retain P(yes), while readiness has an explicit negative veto.
  const twoSided = request.kind === "tools" && request.noulPolicy === "two-sided";
  const confidence = choiceAnswer?.confidence ?? scoreAnswer?.confidence
    ?? (noulAnswer ? twoSided ? Math.max(noulAnswer.noul, 1 - noulAnswer.noul) : noulAnswer.noul : 0);
  const threshold = request.threshold ?? 0.7;
  const validChoice = choiceAnswer !== undefined && request.candidates.includes(choiceAnswer.choice)
    || noulAnswer !== undefined && request.candidates.length === 2
    || scoreAnswer !== undefined && request.candidates.length >= 2 && scoreAnswer.score <= request.candidates.length - 1;
  const policyChecks = request.policyChecks ?? [];
  const failures = policyChecks.filter(check => check.result === "fail");
  const nonApplyingChoice = choiceAnswer !== undefined && (request.nonApplyingCandidates ?? []).includes(choiceAnswer.choice);
  const scopeVeto = request.kind === "readiness" && request.noulPolicy === "scope-veto" && noulAnswer !== undefined;
  const belowThreshold = scopeVeto ? noulAnswer.noul <= 1 - threshold + 1e-9 : confidence < threshold;
  const escalated = failures.length > 0 || !validChoice || nonApplyingChoice || belowThreshold;
  // Preserve the original policy when replaying historical records.
  const readinessUncertain = request.kind === "readiness" && !scopeVeto && validChoice && !nonApplyingChoice
    && policyChecks.every(check => check.result === "pass") && confidence < threshold;
  let choice = "escalate";
  if (scopeVeto) choice = escalated ? "blocked" : "ready";
  else if (readinessUncertain) choice = "uncertain";
  else if (escalated && request.kind === "readiness") choice = "blocked";
  else if (choiceAnswer && validChoice) choice = choiceAnswer.choice;
  else if (noulAnswer && validChoice) choice = request.candidates[noulAnswer.noul >= 0.5 ? 0 : 1]!;
  else if (scoreAnswer && validChoice) choice = request.candidates[Math.round(scoreAnswer.score)]!;

  let reasons: string[];
  if (failures.length) reasons = failures.map(check => check.reason ?? `Policy check failed: ${check.name}.`);
  else if (readinessUncertain) reasons = [`Jev is unsure this issue is ready (${confidence.toFixed(2)}, needs ${threshold.toFixed(2)}). All deterministic readiness checks pass. Review the acceptance criteria in Linear, add any missing detail, then retry, or answer in Mission Control to ask Jev again.`];
  else if (!validChoice) reasons = [`Jev ${request.kind}: invalid or missing answer; no executable choice applied.`];
  else if (nonApplyingChoice) reasons = [`Jev selected ${choice}; no executable candidate applied.`];
  else if (scopeVeto) reasons = [escalated
    ? `Jev finds essential scope missing: P(missing scope)=${(1 - noulAnswer.noul).toFixed(2)} meets ${threshold.toFixed(2)}. Clarify the expected behavior or conflicting scope before implementation.`
    : `No confident essential-scope veto (P(ready)=${noulAnswer.noul.toFixed(2)}; block only at P(missing scope)>=${threshold.toFixed(2)}). Deterministic checks passed; bounded implementation may begin.`];
  else if (belowThreshold) reasons = [`Jev ${request.kind}: confidence ${confidence.toFixed(2)} does not meet ${threshold.toFixed(2)}; no executable choice applied.`];
  else reasons = [twoSided ? `Jev tool necessity: ${choice}; P(yes)=${noulAnswer?.noul.toFixed(2)}; probability of selected side=${confidence.toFixed(2)}.` : "Jev selected the highest-confidence candidate."];
  return { decisionId: request.decisionId, executionId: request.executionId, question: request.question, inputs: request.inputs,
    choice, candidates: request.candidates, confidence, reasons, evidenceRefs: request.evidenceRefs ?? [], policyChecks,
    kind: request.kind, applied: !escalated, escalated, answerType,
    ...(choiceAnswer ? { probabilities: choiceAnswer.probabilities } : {}),
    ...(scoreAnswer ? { probabilities: scoreAnswer.probabilities, score: scoreAnswer.score } : {}),
    ...(noulAnswer ? { noul: noulAnswer.noul } : {}),
    ...(request.overrides !== undefined ? { overrides: request.overrides } : {}), ...(model ? { model } : {}) };
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
    const results = await Promise.allSettled(requests.map(async request => {
      const answerType = request.answerType ?? "choice";
      const question: JevQuestion = answerType === "choice"
        ? { type: "choice", instructions: request.question, criteria: Object.fromEntries(request.candidates.map(candidate => [candidate, request.criteria?.[candidate] ?? `Select ${candidate} only when it best matches the supplied state.`])) }
        : answerType === "noul"
          ? { type: "noul", instructions: request.question, criteria: { true: request.criteria?.true ?? request.candidates[0] ?? "true", false: request.criteria?.false ?? request.candidates[1] ?? "false" } }
          : { type: "score", instructions: request.question, criteria: request.candidates.map(candidate => request.criteria?.[candidate] ?? candidate) };
      try {
        const response = await this.client.evaluate(request.state, { [request.decisionId]: question });
        return { response, decision: this.apply(request, response.answers[request.decisionId], response.model) };
      } catch (error) {
        if (error instanceof JevUnavailableError) this.apply({ ...request, policyChecks: [...request.policyChecks ?? [], { name: "jev-available", result: "fail", reason: `Jev unavailable. ${error.message}` }] }, undefined);
        throw error;
      }
    }));
    const decisions: AppliedDecision[] = [];
    const response: JevResponse = { model: "none", answers: {} };
    let failure: unknown;
    for (const result of results) {
      if (result.status === "rejected") { failure ??= result.reason; continue; }
      decisions.push(result.value.decision);
      response.model = result.value.response.model;
      Object.assign(response.answers, result.value.response.answers);
    }
    if (failure) throw failure;
    return { decisions, response };
  }
  async decide(request: DecisionRequest): Promise<AppliedDecision> { return (await this.preflight([request])).decisions[0]!; }
  async planIssue(input: PreflightInput): Promise<PreflightPlan> { return planPreflight(input, this, this.audit); }
  async selectRoute(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "route" }); }
  async selectSkills(input: SkillsInput): Promise<AppliedDecision & { plan: SkillPlan }> { return decideSkills(input, this.client, this.audit); }
  async selectPlaybook(input: PlaybookInput): Promise<AppliedDecision & { playbookPlan: PlaybookPlan }> { return decidePlaybook(input, this.client, this.audit); }
  async selectSkill(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "skill" }); }
  async selectAgent(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "agent" }); }
  async rankContext(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "context" }); }
  /** Ask one typed Noul for each acceptance condition over the supplied evidence. */
  async judgeAcceptance(request: AcceptanceJudgmentRequest): Promise<AcceptanceJudgment[]> {
    if (request.criteria.length === 0) return [];
    const attemptId = request.attemptId ?? randomUUID();
    const threshold = request.threshold ?? 0.7;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Acceptance threshold must be between 0 and 1");
    const requests: DecisionRequest[] = request.criteria.map(criterion => ({
      decisionId: `acceptance-${request.executionId}-${attemptId}-${criterion.id}`, executionId: request.executionId,
      kind: "acceptance", answerType: "noul", threshold,
      question: `Does the current implementation satisfy this acceptance criterion: ${criterion.description}? Judge only the supplied diff, authoritative checks and actual tool results. A denied tool did not execute: do not treat its requested operation or the session's claims as evidence. Distinguish a denial that prevented required work from a harmless denied inspection or an operation subsequently demonstrated by permitted tools or authoritative checks.`,
      criteria: { true: "The diff, authoritative checks and actual non-denied tool outputs demonstrate the criterion is satisfied. A denied optional call alone does not invalidate this evidence.", false: "Required evidence is missing, contradictory or failing, including when a denied call prevented required work with no successful alternative demonstration." },
      state: request.state, inputs: [{ name: "attempt", value: request.attempt ?? 1 }, { name: "attemptId", value: attemptId }], candidates: ["yes", "no"],
    }));
    const result = await this.preflight(requests);
    return request.criteria.map((criterion, index) => {
      const decision = result.decisions[index]!;
      return { criterionId: criterion.id, probability: decision.noul ?? 0, passed: decision.applied && (decision.noul ?? 0) >= threshold };
    });
  }

  apply(request: DecisionRequest, answer: JevAnswer | undefined, model?: string): AppliedDecision {
    const result = applyDecision(request, answer, model);
    this.audit.append({ request: redact(structuredClone(request)) as DecisionRequest, response: result, recordedAt: this.now(), ...(answer ? { rawAnswer: structuredClone(answer) } : {}), ...(request.overrides !== undefined ? { overrides: redact(request.overrides) as JsonValue } : {}) });
    return result;
  }
  /** Record a deterministic policy result without inventing a Jev answer or confidence. */
  recordPolicyChoice(request: DecisionRequest, choice: string, reason: string): AppliedDecision {
    if (!request.candidates.includes(choice) || request.policyChecks?.some(check => check.result === "fail")) throw new Error("Invalid deterministic policy choice");
    const decision: AppliedDecision = { decisionId: request.decisionId, executionId: request.executionId,
      kind: request.kind, question: request.question, inputs: request.inputs, candidates: request.candidates,
      choice, confidence: 0, reasons: [reason], applied: true, escalated: false,
      evidenceRefs: request.evidenceRefs ?? [], policyChecks: request.policyChecks ?? [] };
    this.audit.append({ request, response: decision, recordedAt: this.now() });
    return decision;
  }
  get(decisionId: string): DecisionAuditRecord | undefined { return this.audit.get(decisionId); }
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
