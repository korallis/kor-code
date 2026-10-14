import type { CatalogueModel, Route } from "@kor-code/core";
import type { DaemonOptions } from "@kor-code/daemon";
import { JevClient, JevDecisionCore, planPreflight, routeFromDecision, type DecisionAuditLog } from "@kor-code/jev";

/** One persistent decision core for serve's preflight and acceptance judgments. */
export function createServeRouting(options: {
  audit: DecisionAuditLog;
  defaultRoute: Route;
  models: () => Promise<readonly CatalogueModel[]>;
  client?: Pick<JevClient, "evaluate">;
}) {
  const jev = new JevDecisionCore(options.client ?? new JevClient(), options.audit);
  const chooseRoute: NonNullable<DaemonOptions["chooseRoute"]> = async ({ executionId, issue }) => {
    const models = await options.models();
    const decisionId = `route-${executionId}`;
    let route: Route;
    if (options.audit.get(decisionId)) {
      const decision = options.audit.replay(decisionId);
      route = decision.applied && !decision.escalated && models.some(model => model.model === decision.choice && model.available !== false)
        ? routeFromDecision(decision, models, { ...options.defaultRoute, label: "jev", decisionId })
        : { ...options.defaultRoute, label: "fallback", decisionId };
    } else {
      const plan = await planPreflight({ executionId,
        issue: { id: issue.id, title: issue.title, ...(issue.description !== undefined ? { description: issue.description } : {}), acceptanceCriteria: issue.acceptanceCriteria, dependencies: issue.dependencies.map(dependency => ({ id: dependency.id, state: dependency.stateType })) },
        verifiedModels: models, defaultRoute: options.defaultRoute,
      }, jev, options.audit);
      route = plan.route;
    }
    return { route, source: route.label === "jev" ? "jev" : "fallback" };
  };
  return { jev, chooseRoute };
}
