import type { CatalogueModel, DecisionBundle, DecisionInput, JsonValue, Route } from "@kor-code/core";
import { JevUnavailableError } from "./client.js";
import type { JevJsonValue } from "./contracts.js";
import { ROUTING_POLICY_VERSION, conservativeModel, isRoutableModel, modelCriteria, modelReasoningClass, modelsForClass, reasoningCriteria, type ReasoningClass } from "./routing.js";
import type { JevDecisionCore, AppliedDecision, DecisionAuditLog, DecisionRequest, PreflightResult } from "./index.js";

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

/** A sibling outage cannot cancel a real readiness veto or deterministic failure. */
export function readinessBlocksDispatch(readiness: AppliedDecision | undefined): boolean {
  if (!readiness) return true;
  if (readiness.policyChecks.some(check => check.result === "fail" && check.name !== "jev-available")) return true;
  const unavailable = !readiness.model && (readiness.policyChecks.some(check => check.name === "jev-available" && check.result === "fail")
    || readiness.reasons.some(reason => reason.startsWith("Jev unavailable.")));
  return !unavailable && (!readiness.applied || readiness.choice !== "ready");
}

function issueState(input: PreflightInput, readinessChecks: DecisionBundle["policyChecks"]): Record<string, JsonValue> {
  return {
    routingPolicyVersion: ROUTING_POLICY_VERSION,
    defaultRoute: { ...input.defaultRoute },
    modelProfiles: modelCriteria(input.verifiedModels),
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
  const models = inputData.verifiedModels.filter(isRoutableModel).map(model => model.model);
  const routeCandidates = models.length >= 2 ? models : [...models, "no-verified-route", "clarification"].slice(0, 2);
  const readinessChecks = [
    ...issueReadinessChecks(inputData.issue),
    { name: "verified-route", result: models.length > 0 ? "pass" as const : "fail" as const, ...(models.length ? {} : { reason: "No available model has both verified streaming/tool/structured-output support and a maintained reasoning profile. Run kor models probe or add a routing profile before retrying." }) },
  ];
  const routeCriteria: Record<string, JevJsonValue> = modelCriteria(inputData.verifiedModels);
  routeCriteria["no-verified-route"] = "None of the offered models has the required verified capabilities or a maintained role suitable for this issue.";
  routeCriteria.clarification = "The issue cannot be assigned to an offered model without an essential scope decision.";
  const threshold = inputData.threshold ?? 0.7;
  const routingInput = issueState(inputData, readinessChecks);
  const common = { executionId: inputData.executionId,
    state: { issue: routingInput.issue, readinessChecks: routingInput.readinessChecks, routingPolicyVersion: ROUTING_POLICY_VERSION },
    inputs: [input("issue", inputData.issue.title), input("routing-input", routingInput, "routing-policy")], threshold };
  return [
    { ...common, decisionId: decisionId(inputData, "readiness"), kind: "readiness", answerType: "noul", noulPolicy: "scope-veto", threshold: 0.9, question: "Is the issue sufficiently specified to begin implementation? Judge missing essential scope, not implementation difficulty or confidence that the code will pass verification. Treat the supplied passing readinessChecks as established facts. Concrete file, export, input and behavior requirements are sufficient; do not require a build setup, design decisions or background that the task does not need.", candidates: ["ready", "blocked"], policyChecks: readinessChecks, criteria: { true: "All readinessChecks pass and a coding worker can start the bounded change from the stated acceptance criteria without asking the operator an essential scope question.", false: "A readinessCheck fails, or an essential expected behavior or scope decision is missing or contradictory, so implementation needs operator input." } },
    { ...common, decisionId: decisionId(inputData, "complexity"), kind: "complexity", answerType: "score", question: "How much implementation scope does this single issue require? Judge the issue itself, not the whole project. Level 0 is a local mechanical edit; level 1 requires interacting files within an established design; level 2 spans subsystems or unresolved architecture.", candidates: [...complexityLevels], threshold: 0 },
    { ...common, decisionId: decisionId(inputData, "risk"), kind: "risk", answerType: "score", question: "How much correctness or operational risk does the requested change introduce? Level 0 is reversible local behavior; level 1 requires ordinary review; level 2 affects authorization, production data integrity or hard-to-reverse external changes. Do not score high merely because the product operates in a regulated domain.", candidates: [...riskLevels], threshold: 0 },
    { ...common, decisionId: decisionId(inputData, "reasoning-class"), kind: "reasoning-class", question: "Which is the least demanding reasoning class sufficient for this single issue? Use the stated task, acceptance conditions and supplied complexity/risk assessments. Judge the actual implementation obligations, not the product domain in general. Reviewing, landing or merging an existing PR requires independent correctness review and belongs to deep; do not classify that as routine merely because implementation already exists. For new implementation use implementation unless the stated work actually requires unresolved architecture or high-risk diagnosis.", candidates: Object.keys(reasoningCriteria), criteria: reasoningCriteria },
    { ...common, decisionId: decisionId(inputData, "route"), kind: "route", question: "Which offered model role best fits the primary work of this single issue within the selected reasoning class? Use the maintained strengths and avoid criteria to distinguish roles. Probe costs and latency are observations, not workload prices or quality scores. Choose no-verified-route if no offered model can perform the work. When the issue asks to review, land or merge an existing PR, use the correctness review role; the feature size describes existing code rather than new construction. Confidence is conditional on this class; it is not end-to-end success probability.", candidates: routeCandidates, policyChecks: [{ name: "verified-model", result: models.length > 0 ? "pass" : "fail" }], criteria: routeCriteria, nonApplyingCandidates: ["no-verified-route", "clarification"] },
    { ...common, decisionId: decisionId(inputData, "agent"), kind: "agent", question: "Which available agent profile best supports this issue? Select generalist for bounded implementation or documentation. Select specialist only when the issue explicitly requires deep domain expertise or a broad investigation.", candidates: [...(inputData.agents ?? defaultAgents)], criteria: Object.fromEntries((inputData.agents ?? defaultAgents).map(agent => [agent, agent === "generalist" ? "Default coding role for bounded implementation, documentation, ordinary diagnosis, verification, review and landing an existing PR in an established design. This role can perform correctness reviews; specialist subject matter alone does not require another role." : agent === "specialist" ? "Use only for unresolved architectural research or an explicitly required domain-specialist investigation; subject matter alone is insufficient." : `Configured agent role ${agent}; no additional responsibilities or specialist capabilities are declared.`])) },
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
  return requests.map(request => {
    const saved = audit.get(request.decisionId);
    if (saved) return saved.response;
    const response = fallbackDecision(request, request.kind === "readiness" ? "blocked" : request.kind === "route" ? route.model : "escalate", reason);
    audit.append({ request, response, recordedAt: new Date().toISOString() });
    return response;
  });
}

/** A single route policy for fresh plans, durable replay and controller dispatch. */
export function preflightRoute(input: Pick<PreflightInput, "verifiedModels" | "defaultRoute">, routeDecision: AppliedDecision, classDecision?: AppliedDecision): Route {
  const requestedClass = classDecision?.applied && (classDecision.choice === "routine" || classDecision.choice === "implementation" || classDecision.choice === "deep") ? classDecision.choice : "deep";
  const eligible = modelsForClass(input.verifiedModels, requestedClass);
  const selected = routeDecision.applied && !routeDecision.escalated ? eligible.find(model => model.model === routeDecision.choice) : undefined;
  const jevSelected = classDecision?.applied && selected !== undefined;
  const fallbackReason = jevSelected ? undefined : [...(!classDecision?.applied ? classDecision?.reasons ?? ["Reasoning-class assessment unavailable."] : []), ...(!routeDecision.applied ? routeDecision.reasons : !selected ? ["The recorded model is no longer verified and available in the selected class."] : [])].join(" ");
  if (!jevSelected || !selected) return fallbackRoute(input, routeDecision.decisionId, fallbackReason ?? "No executable Jev route.");
  const reasoningClass = modelReasoningClass(selected.model) ?? requestedClass;
  const levels: Record<ReasoningClass, "low" | "medium" | "high"> = { routine: "low", implementation: "medium", deep: "high" };
  return { ...input.defaultRoute, model: selected.model, provider: selected.provider, label: "jev", decisionId: routeDecision.decisionId, reasoningClass, reasoningLevel: input.defaultRoute.reasoningLevel ?? levels[reasoningClass] };
}

function fallbackRoute(input: Pick<PreflightInput, "verifiedModels" | "defaultRoute">, decisionId: string, reason: string): Route {
  const configured = input.verifiedModels.find(model => model.model === input.defaultRoute.model && model.provider === input.defaultRoute.provider && isRoutableModel(model));
  const model = configured ?? conservativeModel(input.verifiedModels);
  const reasoningClass = modelReasoningClass(model?.model ?? input.defaultRoute.model);
  const selectionReason = configured ? "Using the verified configured default route."
    : model ? "The configured default is unavailable or lacks verified capabilities/profile; using a verified conservative replacement."
      : "No verified profiled fallback is available; dispatch remains blocked.";
  return { ...input.defaultRoute, ...(model ? { model: model.model, provider: model.provider } : {}), label: "fallback", decisionId,
    ...(reasoningClass ? { reasoningClass } : {}), fallbackReason: `${reason} ${selectionReason}` };
}

export async function planPreflight(inputData: PreflightInput, core: JevDecisionCore, audit: DecisionAuditLog): Promise<PreflightPlan> {
  const requests = makeRequests(inputData);
  const initial = requests.filter(request => request.kind !== "route" && request.kind !== "reasoning-class");
  const classRequest = requests.find(request => request.kind === "reasoning-class")!;
  const routeRequest = requests.find(request => request.kind === "route")!;
  try {
    const pending = initial.filter(request => !audit.get(request.decisionId));
    const evaluated = await core.preflight(pending);
    const result = { ...evaluated, decisions: initial.map(request => audit.replay(request.decisionId)) };
    const assessments = Object.fromEntries(result.decisions.filter(decision => decision.kind === "complexity" || decision.kind === "risk").map(decision => [decision.kind, { score: decision.score ?? null, confidence: decision.confidence, probabilities: decision.probabilities ?? {} }]));
    const fullState = issueState(inputData, initial.find(request => request.kind === "readiness")?.policyChecks ?? []);
    const baseState = { issue: fullState.issue, readinessChecks: fullState.readinessChecks, routingPolicyVersion: ROUTING_POLICY_VERSION };
    classRequest.state = { ...baseState, routingAssessment: assessments };
    const classDecision = audit.get(classRequest.decisionId) ? audit.replay(classRequest.decisionId) : await core.decide(classRequest);
    const observedClass = classDecision.choice === "routine" || classDecision.choice === "implementation" || classDecision.choice === "deep" ? classDecision.choice : undefined;
    const reasoningClass = classDecision.applied ? observedClass : "deep";
    const eligible = reasoningClass ? modelsForClass(inputData.verifiedModels, reasoningClass) : [];
    routeRequest.state = { ...baseState, routingAssessment: { ...assessments, reasoningClass: reasoningClass ?? "unknown", classConfidence: classDecision.confidence, observedClass: observedClass ?? "unknown", classSource: classDecision.applied ? "jev" : "conservative-fallback" } };
    routeRequest.candidates = [...eligible.map(model => model.model), "no-verified-route"];
    routeRequest.criteria = { ...modelCriteria(eligible), "no-verified-route": "No offered model role fits this issue or the selected class has no available profiled model." };
    // Choice requires two alternatives. No eligible model is a deterministic constraint failure.
    const routeDecision = audit.get(routeRequest.decisionId) ? audit.replay(routeRequest.decisionId) : eligible.length
      ? await core.decide(routeRequest)
      : core.apply({ ...routeRequest, policyChecks: [{ name: "class-model-available", result: "fail", reason: `No available profiled model in reasoning class ${reasoningClass ?? "unknown"}.` }] }, undefined);
    result.decisions.push(classDecision, routeDecision);
    for (const decision of [classDecision, routeDecision]) {
      const raw = audit.get(decision.decisionId)?.rawAnswer;
      if (raw) result.response.answers[decision.decisionId] = raw;
    }
    result.response.model = routeDecision.model ?? classDecision.model ?? result.response.model;
    const route = preflightRoute(inputData, routeDecision, classDecision);
    return { executionId: inputData.executionId, route, decisions: result.decisions, response: result.response, fallback: route.label === "fallback" };
  } catch (error) {
    if (!(error instanceof JevUnavailableError)) throw error;
    const reason = error.message;
    const route = fallbackRoute(inputData, decisionId(inputData, "route"), `Jev unavailable: ${reason}`);
    return { executionId: inputData.executionId, route, decisions: appendFallback(audit, requests, route, `Jev unavailable. ${route.fallbackReason}`), fallback: true, outage: reason };
  }
}

export function preflightRequests(inputData: PreflightInput): readonly DecisionRequest[] { return makeRequests(inputData); }
