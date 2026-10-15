import type { CatalogueModel, DecisionBundle, DecisionInput, JsonValue, Route } from "@kor-code/core";
import { JevUnavailableError } from "./client.js";
import type { JevJsonValue } from "./contracts.js";
import { JevDecisionCore, type AppliedDecision, type DecisionAuditLog, type DecisionRequest, type PreflightResult } from "./index.js";

export interface PreflightIssue {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria: string[];
  dependencies: Array<{ id: string; state: string }>;
  labels?: string[];
  hasScreenshot?: boolean;
}
export interface PreflightInput {
  executionId: string;
  /** Reuse the audit only while the issue and eligible models remain identical. */
  decisionRevision?: string;
  issue: PreflightIssue;
  verifiedModels: readonly CatalogueModel[];
  defaultRoute: Route;
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

const defaultAgents = ["generalist", "specialist"] as const;
const complexityLevels = ["small bounded change", "multi-file change", "cross-system change"] as const;
const riskLevels = ["low operational risk", "review required", "high risk or external change"] as const;

export function screenshotReadinessCheck(issue: Pick<PreflightIssue, "labels" | "hasScreenshot">): DecisionBundle["policyChecks"][number] {
  const requiresScreenshot = (issue.labels ?? []).some(label => label.trim().toLowerCase() === "ui");
  if (!requiresScreenshot || issue.hasScreenshot === true) return { name: "ui-screenshot", result: "pass" };
  return { name: "ui-screenshot", result: "fail", reason: "UI-labelled tickets need a screenshot or mockup. Embed an image in the description or a comment, or attach an image file, then retry." };
}

export function issueReadinessChecks(issue: PreflightIssue): DecisionBundle["policyChecks"] {
  const checks: DecisionBundle["policyChecks"] = [
    { name: "acceptance-criteria", result: issue.acceptanceCriteria.length > 0 ? "pass" : "fail", reason: "Add explicit acceptance criteria to the issue." },
    { name: "dependencies-complete", result: issue.dependencies.every(dependency => dependency.state === "completed") ? "pass" : "fail", reason: "Complete the issue's blocking dependencies before retrying." },
    screenshotReadinessCheck(issue),
  ];
  return checks.map(check => {
    if (check.result !== "pass") return check;
    const { reason: _, ...passed } = check;
    return passed;
  });
}

function issueState(input: PreflightInput, readinessChecks: DecisionBundle["policyChecks"]): JsonValue {
  return {
    issue: { id: input.issue.id, title: input.issue.title, description: input.issue.description ?? "", acceptance: input.issue.acceptanceCriteria, dependencies: input.issue.dependencies, labels: input.issue.labels ?? [], hasScreenshot: input.issue.hasScreenshot ?? false },
    verifiedModels: input.verifiedModels.map(model => ({ model: model.model, provider: model.provider, capabilities: Object.fromEntries(model.capabilities.map(capability => [capability.name, capability.supported])), ...(model.costUsd !== undefined ? { costUsd: model.costUsd } : {}), ...(model.durationMs !== undefined ? { durationMs: model.durationMs } : {}) })),
    readinessChecks: readinessChecks.map(check => ({ ...check })),
  };
}
function input(name: string, value: JsonValue, source = "linear"): DecisionInput { return { name, value, source }; }
function decisionId(inputData: PreflightInput, kind: string): string {
  return `${kind}-${inputData.executionId}${inputData.decisionRevision ? `-${inputData.decisionRevision}` : ""}`;
}
function makeRequests(inputData: PreflightInput): DecisionRequest[] {
  const models = inputData.verifiedModels.map(model => model.model);
  const routeCandidates = models.length >= 2 ? models : [...models, "no-verified-route", "clarification"].slice(0, 2);
  const readinessChecks = [
    ...issueReadinessChecks(inputData.issue),
    { name: "verified-route", result: models.length > 0 ? "pass" as const : "fail" as const, ...(models.length ? {} : { reason: "No verified model is available; run kor models probe before retrying." }) },
  ];
  const routeCriteria: Record<string, JevJsonValue> = Object.fromEntries(inputData.verifiedModels.map(model => [model.model, {
    provider: model.provider,
    capabilities: Object.fromEntries(model.capabilities.map(capability => [capability.name, capability.supported])),
    ...(model.costUsd !== undefined ? { costUsd: model.costUsd } : {}),
    ...(model.durationMs !== undefined ? { durationMs: model.durationMs } : {}),
  }]));
  for (const candidate of routeCandidates) if (!Object.hasOwn(routeCriteria, candidate)) routeCriteria[candidate] = { reason: candidate === "no-verified-route" ? "No verified model is available." : "Ask the user for a route." };
  const threshold = inputData.threshold ?? 0.7;
  const common = { executionId: inputData.executionId, state: issueState(inputData, readinessChecks), inputs: [input("issue", inputData.issue.title)], threshold };
  return [
    { ...common, decisionId: decisionId(inputData, "readiness"), kind: "readiness", answerType: "noul", question: "Is the issue sufficiently specified to begin implementation? Judge missing essential scope, not implementation difficulty or confidence that the code will pass verification. Treat the supplied passing readinessChecks as established facts. Concrete file, export, input and behavior requirements are sufficient; do not require a build setup, design decisions or background that the task does not need.", candidates: ["ready", "blocked"], policyChecks: readinessChecks, criteria: { true: "All readinessChecks pass and a coding worker can start the bounded change from the stated acceptance criteria without asking the operator an essential scope question.", false: "A readinessCheck fails, or an essential expected behavior or scope decision is missing or contradictory, so implementation needs operator input." } },
    { ...common, decisionId: decisionId(inputData, "complexity"), kind: "complexity", answerType: "score", question: "How complex is this issue for an isolated coding session?", candidates: [...complexityLevels], threshold: 0 },
    { ...common, decisionId: decisionId(inputData, "risk"), kind: "risk", answerType: "score", question: "How much delivery or operational risk does this issue carry?", candidates: [...riskLevels], threshold: 0 },
    { ...common, decisionId: decisionId(inputData, "route"), kind: "route", question: "Which verified model best fits this issue? Compare the supplied provider, capabilities, cost, and duration. Choose no-verified-route when no supplied model is suitable.", candidates: routeCandidates, policyChecks: [{ name: "verified-model", result: models.length > 0 ? "pass" : "fail" }], criteria: routeCriteria, nonApplyingCandidates: ["no-verified-route", "clarification"] },
    { ...common, decisionId: decisionId(inputData, "agent"), kind: "agent", question: "Which available agent profile best supports this issue? Select generalist for bounded implementation or documentation. Select specialist only when the issue explicitly requires deep domain expertise or a broad investigation.", candidates: [...(inputData.agents ?? defaultAgents)], criteria: { generalist: "A coding worker can complete the bounded change with ordinary repository context.", specialist: "Requires deep domain expertise, architecture research, or specialized investigation." } },
  ];
}

function fallbackDecision(request: DecisionRequest, choice: string, reason: string): AppliedDecision {
  return {
    decisionId: request.decisionId, executionId: request.executionId, question: request.question, inputs: request.inputs,
    choice, candidates: request.candidates, confidence: 0, reasons: [reason, ...(request.policyChecks ?? []).filter(check => check.result === "fail").map(check => check.reason ?? `Policy check failed: ${check.name}.`)], evidenceRefs: request.evidenceRefs ?? [], policyChecks: request.policyChecks ?? [], kind: request.kind,
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
    const selected = routeDecision.applied ? inputData.verifiedModels.find(model => model.model === routeDecision.choice && model.available !== false) : undefined;
    const route: Route = { ...inputData.defaultRoute, ...(selected ? { model: selected.model, provider: selected.provider } : {}), label: selected ? "jev" : "fallback", decisionId: routeDecision.decisionId };
    return { executionId: inputData.executionId, route, decisions: result.decisions, response: result.response, fallback: false };
  } catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    const reason = error.message;
    const route: Route = { ...inputData.defaultRoute, label: "fallback", decisionId: decisionId(inputData, "route") };
    return { executionId: inputData.executionId, route, decisions: appendFallback(audit, requests, route, `Jev unavailable. Default route is labelled fallback. ${reason}`), fallback: true, outage: reason };
  }
}

export function preflightRequests(inputData: PreflightInput): readonly DecisionRequest[] { return makeRequests(inputData); }
