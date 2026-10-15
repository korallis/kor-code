import { createHash } from "node:crypto";
import { hasScreenshot } from "@kor-code/linear";
import type { CatalogueModel, Route } from "@kor-code/core";
import { NeedsInputError, type DaemonOptions, type DescribePullRequest } from "@kor-code/daemon";
import { JevClient, JevDecisionCore, JevUnavailableError, MemoryDecisionAuditLog, redact, planPreflight, preflightRequests, routeFromDecision, type DecisionAuditLog } from "@kor-code/jev";

const PR_ROUTE_ATTEMPTS = 2;

/** One persistent decision core for serve's preflight and acceptance judgments. */
export function createServeRouting(options: {
  audit: DecisionAuditLog;
  defaultRoute: Route;
  models: () => Promise<readonly CatalogueModel[]>;
  client?: Pick<JevClient, "evaluate">;
  complete?: (prompt: string, route: Route) => Promise<string>;
}) {
  const client = options.client ?? new JevClient();
  const jev = new JevDecisionCore(client, options.audit);
  const chooseRoute: NonNullable<DaemonOptions["chooseRoute"]> = async ({ executionId, issue }) => {
    let models: CatalogueModel[] = [];
    let catalogueFailure: JevUnavailableError | undefined;
    try { models = [...await options.models()].sort((a, b) => a.model.localeCompare(b.model)); }
    catch (cause) { catalogueFailure = new JevUnavailableError("Model catalogue unavailable; check the registry and gateway before retrying.", { cause }); }
    const input = { executionId,
      issue: { id: issue.id, title: issue.title, ...(issue.description !== undefined ? { description: issue.description } : {}), acceptanceCriteria: issue.acceptanceCriteria, labels: issue.labels, hasScreenshot: hasScreenshot(issue), dependencies: issue.dependencies.map(dependency => ({ id: dependency.id, state: dependency.stateType })).sort((a, b) => a.id.localeCompare(b.id)) },
      verifiedModels: models, defaultRoute: options.defaultRoute,
    };
    const state = preflightRequests(input)[0]?.state;
    const original = options.audit.get(`route-${executionId}`);
    const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(redact(value)) ?? 'null').digest('hex').slice(0, 16);
    let decisionRevision = original && fingerprint(original.request.state) !== fingerprint(state) ? fingerprint(state) : undefined;
    const baseRevision = decisionRevision;
    for (let retry = 1; ; retry++) {
      const saved = options.audit.get(`readiness-${executionId}${decisionRevision ? `-${decisionRevision}` : ""}`);
      const savedRoute = options.audit.get(`route-${executionId}${decisionRevision ? `-${decisionRevision}` : ""}`);
      const incomplete = Boolean(saved) !== Boolean(savedRoute);
      const outage = saved && !saved.response.model && saved.response.reasons.some(reason => reason.startsWith("Jev unavailable."));
      if (!incomplete && !outage) break;
      decisionRevision = `${baseRevision ?? "recovery"}-retry-${retry}`;
    }
    const suffix = decisionRevision ? `-${decisionRevision}` : '';
    const decisionId = `route-${executionId}${suffix}`;
    const readinessId = `readiness-${executionId}${suffix}`;
    let route: Route;
    if (options.audit.get(decisionId)) {
      const readiness = options.audit.replay(readinessId);
      if ((readiness.model || readiness.policyChecks.some(check => check.name === "ui-screenshot" && check.result === "fail")) && (!readiness.applied || readiness.choice !== 'ready')) throw new NeedsInputError(readiness.reasons.join(' ') || 'Jev readiness is blocked or uncertain. Clarify the issue or complete its dependencies, then retry.');
      const decision = options.audit.replay(decisionId);
      route = decision.applied && !decision.escalated && models.some(model => model.model === decision.choice && model.available !== false)
        ? routeFromDecision(decision, models, { ...options.defaultRoute, label: "jev", decisionId })
        : { ...options.defaultRoute, label: "fallback", decisionId };
    } else {
      const core = catalogueFailure ? new JevDecisionCore({ evaluate: async () => { throw catalogueFailure; } }, options.audit) : jev;
      const plan = await planPreflight({ ...input, ...(decisionRevision ? { decisionRevision } : {}) }, core, options.audit);
      const readiness = plan.decisions.find(decision => decision.kind === 'readiness');
      if (readiness?.policyChecks.some(check => check.name === 'ui-screenshot' && check.result === 'fail') || !plan.outage && (!readiness?.applied || readiness.choice !== 'ready')) throw new NeedsInputError(readiness?.reasons.join(' ') || 'Jev readiness is blocked or uncertain. Clarify the issue or complete its dependencies, then retry.');
      route = plan.route;
    }
    return { route, source: route.label === "jev" ? "jev" : "fallback" };
  };
  const describePullRequest: DescribePullRequest = async ({ executionId, head, prompt }) => {
    if (!options.complete) throw new Error('PR model completion is unavailable');
    const models = [...await options.models()];
    if (!models.length) throw new Error('PR writing requires a verified model; run kor models probe');
    const baseId = `route-pr-${executionId}-${head}`;
    let decisionId = baseId;
    for (let revision = 1; options.audit.get(decisionId); revision++) {
      const saved = options.audit.replay(decisionId);
      if (saved.applied && !saved.escalated && models.some(model => model.model === saved.choice)) {
        return options.complete(prompt, routeFromDecision(saved, models, { accountPolicy: 'fill-first', sessionAffinity: true, label: 'jev', decisionId }));
      }
      decisionId = `${baseId}-retry-${revision}`;
    }
    for (let attempt = 0; attempt < PR_ROUTE_ATTEMPTS; attempt++) {
      const pending = new MemoryDecisionAuditLog();
      const decision = await new JevDecisionCore(client, pending).selectRoute({
        decisionId, executionId, kind: 'route',
        question: attempt === 0
          ? 'Select a verified model route to write accurate, concise PR prose from this diff and verification evidence.'
          : 'Select a verified route only to write a title, summary, changelog and testing text. Coding and verification are already complete; no repository changes are needed.',
        state: attempt === 0 ? { task: 'pull request description', prompt } : { task: 'write short PR prose from supplied evidence', promptCharacters: prompt.length },
        inputs: [{ name: 'verified commit', value: head, source: 'git' }],
        candidates: [...models.map(model => model.model), "clarification"], nonApplyingCandidates: ["clarification"],
        criteria: { ...Object.fromEntries(models.map(model => [model.model, { provider: model.provider, capabilities: model.capabilities.map(capability => ({ ...capability })), costUsd: model.costUsd ?? null, durationMs: model.durationMs ?? null }])), clarification: "No supplied route is suitable for this PR-writing task." },
      });
      if (!decision.applied || decision.escalated || !models.some(model => model.model === decision.choice)) continue;
      options.audit.append(pending.explain(decisionId));
      return options.complete(prompt, routeFromDecision(decision, models, { accountPolicy: 'fill-first', sessionAffinity: true, label: 'jev', decisionId }));
    }
    return null;
  };
  return { jev, chooseRoute, describePullRequest };
}
