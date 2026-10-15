import { createHash } from "node:crypto";
import { hasScreenshot } from "@kor-code/linear";
import type { CatalogueModel, Route } from "@kor-code/core";
import { NeedsInputError, type DaemonOptions } from "@kor-code/daemon";
import { JevClient, JevDecisionCore, planPreflight, preflightRequests, routeFromDecision, type DecisionAuditLog } from "@kor-code/jev";

/** One persistent decision core for serve's preflight and acceptance judgments. */
export function createServeRouting(options: {
  audit: DecisionAuditLog;
  defaultRoute: Route;
  models: () => Promise<readonly CatalogueModel[]>;
  client?: Pick<JevClient, "evaluate">;
}) {
  const jev = new JevDecisionCore(options.client ?? new JevClient(), options.audit);
  const chooseRoute: NonNullable<DaemonOptions["chooseRoute"]> = async ({ executionId, issue }) => {
    const models = [...await options.models()].sort((a, b) => a.model.localeCompare(b.model));
    const input = { executionId,
      issue: { id: issue.id, title: issue.title, ...(issue.description !== undefined ? { description: issue.description } : {}), acceptanceCriteria: issue.acceptanceCriteria, labels: issue.labels, hasScreenshot: hasScreenshot(issue), dependencies: issue.dependencies.map(dependency => ({ id: dependency.id, state: dependency.stateType })).sort((a, b) => a.id.localeCompare(b.id)) },
      verifiedModels: models, defaultRoute: options.defaultRoute,
    };
    const state = preflightRequests(input)[0]?.state;
    const original = options.audit.get(`route-${executionId}`);
    const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex').slice(0, 16);
    const decisionRevision = original && fingerprint(original.request.state) !== fingerprint(state) ? fingerprint(state) : undefined;
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
      const plan = await planPreflight({ ...input, ...(decisionRevision ? { decisionRevision } : {}) }, jev, options.audit);
      const readiness = plan.decisions.find(decision => decision.kind === 'readiness');
      if (readiness?.policyChecks.some(check => check.name === 'ui-screenshot' && check.result === 'fail') || !plan.outage && (!readiness?.applied || readiness.choice !== 'ready')) throw new NeedsInputError(readiness?.reasons.join(' ') || 'Jev readiness is blocked or uncertain. Clarify the issue or complete its dependencies, then retry.');
      route = plan.route;
    }
    return { route, source: route.label === "jev" ? "jev" : "fallback" };
  };
  return { jev, chooseRoute };
}
