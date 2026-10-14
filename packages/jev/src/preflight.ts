import type { CatalogueModel, DecisionInput, JsonValue, Route } from "@kor-code/core";
import { JevUnavailableError } from "./client.js";
import type { JevJsonValue } from "./contracts.js";
import { JevDecisionCore, type AppliedDecision, type DecisionAuditLog, type DecisionRequest, type PreflightResult } from "./index.js";

export interface PreflightIssue {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria: string[];
  dependencies: Array<{ id: string; state: string }>;
}
export interface PreflightInput {
  executionId: string;
  issue: PreflightIssue;
  verifiedModels: readonly CatalogueModel[];
  defaultRoute: Route;
  skills?: readonly string[];
  agents?: readonly string[];
  threshold?: number;
}
export interface PreflightPlan {
  executionId: string;
  route: Route;
  decisions: AppliedDecision[];
  response?: PreflightResult["response"];
  fallback: boolean;
  outage?: string;
}

const defaultSkills = ["generalist", "testing"] as const;
const defaultAgents = ["generalist", "specialist"] as const;
const complexityLevels = ["small bounded change", "multi-file change", "cross-system change"] as const;
const riskLevels = ["low operational risk", "review required", "high risk or external change"] as const;

function issueState(input: PreflightInput, readinessChecks: readonly { name: string; result: "pass" | "fail" }[] = []): JsonValue {
  return {
    issue: { id: input.issue.id, title: input.issue.title, description: input.issue.description ?? "", acceptance: input.issue.acceptanceCriteria, dependencies: input.issue.dependencies },
    verifiedModels: input.verifiedModels.map(model => ({ model: model.model, provider: model.provider, capabilities: Object.fromEntries(model.capabilities.map(capability => [capability.name, capability.supported])), ...(model.costUsd !== undefined ? { costUsd: model.costUsd } : {}), ...(model.durationMs !== undefined ? { durationMs: model.durationMs } : {}) })),
    readinessChecks: readinessChecks.map(check => ({ name: check.name, result: check.result })),
  };
}
function input(name: string, value: JsonValue, source = "linear"): DecisionInput { return { name, value, source }; }
function makeRequests(inputData: PreflightInput): DecisionRequest[] {
  const models = inputData.verifiedModels.map(model => model.model);
  const routeCandidates = models.length >= 2 ? models : [...models, "no-verified-route", "clarification"].slice(0, 2);
  const readinessChecks = [
    { name: "acceptance-criteria", result: inputData.issue.acceptanceCriteria.length > 0 ? "pass" as const : "fail" as const },
    { name: "dependencies-complete", result: inputData.issue.dependencies.every(dependency => dependency.state === "completed") ? "pass" as const : "fail" as const },
    { name: "verified-route", result: models.length > 0 ? "pass" as const : "fail" as const },
  ];
  const routeCriteria: Record<string, JevJsonValue> = Object.fromEntries(inputData.verifiedModels.map(model => [model.model, {
    provider: model.provider,
    capabilities: Object.fromEntries(model.capabilities.map(capability => [capability.name, capability.supported])),
    ...(model.costUsd !== undefined ? { costUsd: model.costUsd } : {}),
    ...(model.durationMs !== undefined ? { durationMs: model.durationMs } : {}),
  }]));
  for (const candidate of routeCandidates) if (!Object.hasOwn(routeCriteria, candidate)) routeCriteria[candidate] = { reason: candidate === "no-verified-route" ? "No verified model is available." : "Ask the captain for a route." };
  const threshold = inputData.threshold ?? 0.7;
  const common = { executionId: inputData.executionId, state: issueState(inputData, readinessChecks), inputs: [input("issue", inputData.issue.title)], threshold };
  return [
    { ...common, decisionId: `readiness-${inputData.executionId}`, kind: "readiness", answerType: "noul", question: "Is this issue ready for Kor to execute? Answer ready only when the issue has explicit acceptance criteria, every dependency is completed, and the verified route list is non-empty. The state includes each deterministic check.", candidates: ["ready", "blocked"], policyChecks: readinessChecks, criteria: { true: "All supplied readinessChecks pass and the acceptance conditions specify a bounded, actionable change without unresolved scope questions.", false: "At least one readiness check fails, or the issue leaves essential implementation scope or acceptance unclear." } },
    { ...common, decisionId: `complexity-${inputData.executionId}`, kind: "complexity", answerType: "score", question: "How complex is this issue for an isolated coding session?", candidates: [...complexityLevels], threshold: 0 },
    { ...common, decisionId: `risk-${inputData.executionId}`, kind: "risk", answerType: "score", question: "How much delivery or operational risk does this issue carry?", candidates: [...riskLevels], threshold: 0 },
    { ...common, decisionId: `route-${inputData.executionId}`, kind: "route", question: "Which verified model best fits this issue? Compare the supplied provider, capabilities, cost, and duration. Choose no-verified-route when no supplied model is suitable.", candidates: routeCandidates, policyChecks: [{ name: "verified-model", result: models.length > 0 ? "pass" : "fail" }], criteria: routeCriteria, nonApplyingCandidates: ["no-verified-route", "clarification"] },
    { ...common, decisionId: `skill-${inputData.executionId}`, kind: "skill", question: "Which available skill best supports this issue? Select testing when the primary requested deliverable is test development or test diagnosis. Select generalist for implementation, documentation, or configuration work with routine verification.", candidates: [...(inputData.skills ?? defaultSkills)], criteria: { generalist: "Implement or document a bounded change, including routine checks.", testing: "Specialized test development or diagnosis is the main deliverable." } },
    { ...common, decisionId: `agent-${inputData.executionId}`, kind: "agent", question: "Which available agent profile best supports this issue? Select generalist for bounded implementation or documentation. Select specialist only when the issue explicitly requires deep domain expertise or a broad investigation.", candidates: [...(inputData.agents ?? defaultAgents)], criteria: { generalist: "A coding worker can complete the bounded change with ordinary repository context.", specialist: "Requires deep domain expertise, architecture research, or specialized investigation." } },
  ];
}

function fallbackDecision(request: DecisionRequest, choice: string, reason: string): AppliedDecision {
  return {
    decisionId: request.decisionId, executionId: request.executionId, question: request.question, inputs: request.inputs,
    choice, candidates: request.candidates, confidence: 0, reasons: [reason], evidenceRefs: request.evidenceRefs ?? [], policyChecks: request.policyChecks ?? [], kind: request.kind,
    applied: false, escalated: true, answerType: request.answerType ?? "choice",
  };
}

function appendFallback(audit: DecisionAuditLog, requests: readonly DecisionRequest[], route: Route, reason: string): AppliedDecision[] {
  const decisions = requests.map(request => fallbackDecision(request, request.kind === "readiness" ? "blocked" : request.kind === "route" ? route.model : "escalate", reason));
  for (const [index, decision] of decisions.entries()) audit.append({ request: requests[index]!, response: decision, recordedAt: new Date().toISOString() });
  return decisions;
}

export async function planPreflight(inputData: PreflightInput, core: JevDecisionCore, audit: DecisionAuditLog): Promise<PreflightPlan> {
  const requests = makeRequests(inputData);
  try {
    const result = await core.preflight(requests);
    const routeDecision = result.decisions.find(decision => decision.kind === "route")!;
    const selectedVerifiedModel = routeDecision.applied && inputData.verifiedModels.some(model => model.model === routeDecision.choice);
    const routeModel = selectedVerifiedModel ? routeDecision.choice : inputData.defaultRoute.model;
    const route = { ...inputData.defaultRoute, model: routeModel, label: selectedVerifiedModel ? "jev" as const : "escalated" as const };
    return { executionId: inputData.executionId, route, decisions: result.decisions, response: result.response, fallback: false };
  } catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    const reason = error.message;
    const route = { ...inputData.defaultRoute, label: "fallback" as const };
    return { executionId: inputData.executionId, route, decisions: appendFallback(audit, requests, route, `Jev unavailable. Default route is labelled fallback. ${reason}`), fallback: true, outage: reason };
  }
}

export function preflightRequests(inputData: PreflightInput): readonly DecisionRequest[] { return makeRequests(inputData); }
