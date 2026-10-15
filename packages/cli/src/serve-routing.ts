import { createHash } from "node:crypto";
import { hasScreenshot } from "@kor-code/linear";
import type { CatalogueModel, Route } from "@kor-code/core";
import { NeedsInputError, type DaemonOptions } from "@kor-code/daemon";
import { JevClient, JevDecisionCore, JevUnavailableError, redact, planPreflight, preflightRequests, routeFromDecision, type DecisionAuditLog } from "@kor-code/jev";

/** One persistent decision core for serve's preflight and acceptance judgments. */
export function createServeRouting(options: {
  audit: DecisionAuditLog;
  defaultRoute: Route;
  models: () => Promise<readonly CatalogueModel[]>;
  client?: Pick<JevClient, "evaluate">;
}) {
  const jev = new JevDecisionCore(options.client ?? new JevClient(), options.audit);
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
  return { jev, chooseRoute };
}
