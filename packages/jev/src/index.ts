import { readFile } from "node:fs/promises";
import type { CatalogueModel, DecisionBundle, DecisionInput, JsonValue, Route } from "@kor-code/core";

export type QuestionInstructions = string | JsonValue;
export type QuestionKind = "choice" | "noul" | "score";
export interface ChoiceQuestion { type: "choice"; instructions: QuestionInstructions; criteria: Record<string, string | null | JsonValue> }
export interface NoulQuestion { type: "noul"; instructions: QuestionInstructions; criteria?: { true?: string | JsonValue; false?: string | JsonValue } }
export interface ScoreQuestion { type: "score"; instructions: QuestionInstructions; criteria: [string | JsonValue, string | JsonValue, ...(string | JsonValue)[]] }
export type JevQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;
export interface ChoiceAnswer { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
export interface NoulAnswer { type: "noul"; noul: number }
export interface ScoreAnswer { type: "score"; score: number; confidence: number; probabilities?: Record<string, number> }
export type JevAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;
export interface JevResponse { model: string; answers: Record<string, JevAnswer | undefined>; usage?: { input_tokens?: number; output_tokens?: number } }
export interface JevClientOptions { apiKey?: string; endpoint?: string; model?: string; fetch?: typeof globalThis.fetch; maxErrorBodyLength?: number }

async function keyFromRuntimeFile(): Promise<string | undefined> {
  const path = `${process.env.HOME ?? ""}/.config/typesafe/env`;
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?(?:TYPESAFE_API_KEY|TYPESAFE_KEY|JEV_API_KEY)\s*=\s*(.+?)\s*$/.exec(line);
      if (match?.[1]) return match[1].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* Runtime credentials are optional for fixture runs. */ }
  return undefined;
}
export async function resolveJevApiKey(explicit?: string): Promise<string | undefined> {
  return explicit ?? process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_KEY ?? process.env.JEV_API_KEY ?? await keyFromRuntimeFile();
}

export class JevRequestError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`Jev request failed: HTTP ${status}${body ? ` ${body}` : ""}`);
    this.name = "JevRequestError";
    this.status = status;
  }
}

function finiteProbability(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Jev answer has invalid ${field}`);
  return value;
}
function parseAnswer(value: unknown): JevAnswer {
  if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") throw new Error("Jev answer is malformed");
  if (value.type === "choice" && "choice" in value && typeof value.choice === "string" && "confidence" in value && "probabilities" in value && value.probabilities && typeof value.probabilities === "object") {
    const probabilities: Record<string, number> = {};
    for (const [key, probability] of Object.entries(value.probabilities)) probabilities[key] = finiteProbability(probability, `probabilities.${key}`);
    return { type: "choice", choice: value.choice, confidence: finiteProbability(value.confidence, "confidence"), probabilities };
  }
  if (value.type === "noul" && "noul" in value) return { type: "noul", noul: finiteProbability(value.noul, "noul") };
  if (value.type === "score" && "score" in value && "confidence" in value) {
    const probabilities = "probabilities" in value && value.probabilities && typeof value.probabilities === "object" ? Object.fromEntries(Object.entries(value.probabilities).map(([k, v]) => [k, finiteProbability(v, `probabilities.${k}`)])) : undefined;
    return { type: "score", score: finiteProbability(value.score, "score"), confidence: finiteProbability(value.confidence, "confidence"), ...(probabilities ? { probabilities } : {}) };
  }
  throw new Error(`Unsupported or malformed Jev answer type: ${value.type}`);
}

export class JevClient {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly explicitKey: string | undefined;
  private readonly maxErrorBodyLength: number;
  constructor(options: JevClientOptions = {}) {
    this.endpoint = options.endpoint ?? "https://api.typesafe.ai/v1/systemone";
    this.model = options.model ?? "jev-1.13.0";
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.explicitKey = options.apiKey;
    this.maxErrorBodyLength = options.maxErrorBodyLength ?? 2048;
  }
  async evaluate(state: JsonValue, questions: Record<string, JevQuestion>): Promise<JevResponse> {
    const key = await resolveJevApiKey(this.explicitKey);
    if (!key) throw new Error("TypeSafe API key not found (set TYPESAFE_API_KEY or ~/.config/typesafe/env)");
    const response = await this.fetcher(this.endpoint, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ state, model: this.model, questions }) });
    if (!response.ok) {
      const body = (await response.text()).slice(0, this.maxErrorBodyLength).replace(/[\r\n]+/g, " ").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^,; ]+/gi, "$1[redacted]");
      throw new JevRequestError(response.status, body);
    }
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== "object" || !("answers" in raw) || !raw.answers || typeof raw.answers !== "object") throw new Error("Jev response did not contain answers");
    const answers: Record<string, JevAnswer | undefined> = {};
    for (const [id, answer] of Object.entries(raw.answers)) answers[id] = parseAnswer(answer);
    const model = "model" in raw && typeof raw.model === "string" ? raw.model : this.model;
    const usage = "usage" in raw && raw.usage && typeof raw.usage === "object" ? { ...( "input_tokens" in raw.usage && typeof raw.usage.input_tokens === "number" ? { input_tokens: raw.usage.input_tokens } : {}), ...( "output_tokens" in raw.usage && typeof raw.usage.output_tokens === "number" ? { output_tokens: raw.usage.output_tokens } : {}) } : undefined;
    return usage ? { model, answers, usage } : { model, answers };
  }
  async choice<T extends string>(state: JsonValue, question: string, criteria: Record<T, string | null>): Promise<ChoiceAnswer & { choice: T }> {
    const response = await this.evaluate(state, { choice: { type: "choice", instructions: question, criteria } });
    const answer = response.answers.choice;
    if (!answer || answer.type !== "choice" || !(answer.choice in criteria)) throw new Error("Jev response did not contain a valid choice answer");
    return answer as ChoiceAnswer & { choice: T };
  }
}

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
}

export interface PreflightResult { decisions: AppliedDecision[]; response: JevResponse }
export class JevDecisionCore {
  constructor(private readonly client: Pick<JevClient, "evaluate">, private readonly audit: DecisionAuditLog = new MemoryDecisionAuditLog(), private readonly now: () => string = () => new Date().toISOString()) {}
  async preflight(requests: readonly DecisionRequest[]): Promise<PreflightResult> {
    if (requests.length === 0) return { decisions: [], response: { model: "none", answers: {} } };
    const state: JsonValue = requests.map(request => ({ decisionId: request.decisionId, kind: request.kind, state: request.state, inputs: request.inputs.map(input => ({ name: input.name, value: input.value, ...(input.source ? { source: input.source } : {}) })) }));
    const questions: Record<string, JevQuestion> = {};
    for (const request of requests) questions[request.decisionId] = { type: "choice", instructions: request.question, criteria: Object.fromEntries(request.candidates.map(candidate => [candidate, null])) };
    const response = await this.client.evaluate(state, questions);
    const decisions = requests.map(request => this.apply(request, response.answers[request.decisionId], response.model));
    return { decisions, response };
  }
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
  async decide(request: DecisionRequest): Promise<AppliedDecision> { return (await this.preflight([request])).decisions[0]!; }
  async selectRoute(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "route" }); }
  async selectSkill(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "skill" }); }
  async selectAgent(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "agent" }); }
  async rankContext(request: DecisionRequest): Promise<AppliedDecision> { return this.decide({ ...request, kind: "context" }); }
  explain(decisionId: string): DecisionAuditRecord { return this.audit.explain(decisionId); }
  replay(decisionId: string): AppliedDecision { return this.audit.replay(decisionId); }
}

export function routeFromDecision(decision: AppliedDecision, catalogue: readonly CatalogueModel[], base: Omit<Route, "model" | "provider">): Route {
  const model = catalogue.find(item => item.model === decision.choice && item.available !== false);
  if (!model) throw new Error(`Selected model is unavailable: ${decision.choice}`);
  return { ...base, model: model.model, provider: model.provider };
}
