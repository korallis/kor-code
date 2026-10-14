import type { CatalogueModel, DecisionInput, JsonValue, Route } from "@kor-code/core";
import type { JevAnswer } from "./contracts.js";
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

function issueState(input: PreflightInput): JsonValue {
  return {
    issue: { id: input.issue.id, title: input.issue.title, description: input.issue.description ?? "", acceptance: input.issue.acceptanceCriteria, dependencies: input.issue.dependencies },
    verifiedModels: input.verifiedModels.map(model => ({ model: model.model, provider: model.provider, capabilities: Object.fromEntries(model.capabilities.map(capability => [capability.name, capability.supported])) })),
  };
}
function input(name: string, value: JsonValue, source = "linear"): DecisionInput { return { name, value, source }; }
function makeRequests(inputData: PreflightInput): DecisionRequest[] {
  const state = issueState(inputData);
  const models = inputData.verifiedModels.map(model => model.model);
  const routeCandidates = models.length >= 2 ? models : [...models, "no-verified-route", "clarification"].slice(0, 2);
  const threshold = inputData.threshold ?? 0.7;
  const common = { executionId: inputData.executionId, state, inputs: [input("issue", inputData.issue.title)], threshold };
  return [
    { ...common, decisionId: `readiness-${inputData.executionId}`, kind: "readiness", answerType: "noul", question: "Is this issue ready for Kor to execute without captain clarification? Readiness requires explicit acceptance criteria, completed dependencies, and at least one verified route.", candidates: ["ready", "blocked"], policyChecks: [
      { name: "acceptance-criteria", result: inputData.issue.acceptanceCriteria.length > 0 ? "pass" : "fail" },
      { name: "dependencies-complete", result: inputData.issue.dependencies.every(dependency => dependency.state === "completed") ? "pass" : "fail" },
      { name: "verified-route", result: models.length > 0 ? "pass" : "fail" },
    ] },
    { ...common, decisionId: `complexity-${inputData.executionId}`, kind: "complexity", answerType: "score", question: "How complex is this issue for an isolated coding session?", candidates: [...complexityLevels] },
    { ...common, decisionId: `risk-${inputData.executionId}`, kind: "risk", answerType: "score", question: "How much delivery or operational risk does this issue carry?", candidates: [...riskLevels] },
    { ...common, decisionId: `route-${inputData.executionId}`, kind: "route", question: "Which verified model is the best route for this issue and its acceptance conditions?", candidates: routeCandidates, policyChecks: [{ name: "verified-model", result: models.length > 0 ? "pass" : "fail" }] },
    { ...common, decisionId: `skill-${inputData.executionId}`, kind: "skill", question: "Which available skill best supports this issue?", candidates: [...(inputData.skills ?? defaultSkills)] },
    { ...common, decisionId: `agent-${inputData.executionId}`, kind: "agent", question: "Which available agent profile best supports this issue?", candidates: [...(inputData.agents ?? defaultAgents)] },
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
    const routeModel = routeDecision.applied && inputData.verifiedModels.some(model => model.model === routeDecision.choice) ? routeDecision.choice : inputData.defaultRoute.model;
    const route = { ...inputData.defaultRoute, model: routeModel, label: routeDecision.applied ? "jev" as const : "fallback" as const };
    return { executionId: inputData.executionId, route, decisions: result.decisions, response: result.response, fallback: !routeDecision.applied };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Jev service unavailable";
    const route = { ...inputData.defaultRoute, label: "fallback" as const };
    return { executionId: inputData.executionId, route, decisions: appendFallback(audit, requests, route, `Jev unavailable. Default route is labelled fallback. ${reason}`), fallback: true, outage: reason };
  }
}

export function preflightRequests(inputData: PreflightInput): readonly DecisionRequest[] { return makeRequests(inputData); }
