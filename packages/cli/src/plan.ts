import { createHash, randomUUID } from "node:crypto";
import { hasScreenshot } from "@kor-code/tracker";
import { MissionServices } from "@kor-code/daemon";
import { TrackerStore } from "@kor-code/tracker";
import { JevClient, JevDecisionCore, PersistentDecisionAuditLog, planPreflight, type PreflightPlan } from "@kor-code/jev";
import { GatewayAdapter, loadAvailableVerifiedModels, modelProvider, readModelRegistry } from "@kor-code/gateway-adapter";
import { loadKorConfig, runtimePaths } from "@kor-code/config";

function commentId(issueId: string): string {
  const hex = createHash("sha256").update(`kor-preflight:${issueId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function formatPlan(plan: PreflightPlan): string {
  const lines = [`PLAN ${plan.executionId}`, `route: ${plan.route.provider}/${plan.route.model} [${plan.route.label ?? "jev"}]`, `fallback: ${plan.fallback}`];
  if (plan.outage) lines.push(`jev: unavailable (${plan.outage})`);
  for (const decision of plan.decisions) {
    const value = decision.answerType === "noul" ? `${decision.choice} (${decision.noul?.toFixed(2) ?? "0.00"})` : decision.answerType === "score" ? `${decision.choice} (${decision.score?.toFixed(2) ?? "0.00"})` : decision.choice;
    lines.push(`${decision.kind}: ${value}; confidence=${decision.confidence.toFixed(2)}; status=${decision.applied ? "applied" : decision.choice === "uncertain" ? "uncertain" : "blocked"}`);
    if (decision.kind === "readiness" && decision.choice === "uncertain") lines.push(...decision.reasons);
    if (decision.kind === "readiness") lines.push(...decision.policyChecks.filter(check => check.result !== "pass").map(check => `${check.name}: ${check.result}; ${check.reason ?? "Resolve this policy check, then retry."}`));
  }
  return lines.join("\n");
}
export async function runPlan(issueId: string, environment: NodeJS.ProcessEnv = process.env): Promise<{ plan: PreflightPlan; output: string; commentWritten: boolean }> {
  const paths = runtimePaths(environment);
  const config = await loadKorConfig(paths.configFile, { home: paths.home });
  const mission = new MissionServices(paths);
  await mission.initialize();
  const client = mission.tracker(config.config);
  const issue = await client.getIssue(issueId);
  const registry = await readModelRegistry(paths.modelsFile);
  const verifiedModels = (await loadAvailableVerifiedModels(registry, () => new GatewayAdapter().listModels())).map(result => ({ provider: modelProvider(result.model, result.provider), model: result.model, capabilities: Object.entries(result.capabilities).map(([name, supported]) => ({ name, supported })), ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}), ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}) }));
  const store = new TrackerStore(paths.databaseFile);
  const audit = new PersistentDecisionAuditLog({ read: decisionId => store.readDecisionAudit(decisionId), write: (decisionId, recordedAt, payload) => store.writeDecisionAudit(decisionId, recordedAt, payload), update: (decisionId, recordedAt, payload) => store.updateDecisionAudit(decisionId, recordedAt, payload) });
  const jevKey = environment.TYPESAFE_API_KEY ?? environment.TYPESAFE_KEY ?? environment.JEV_API_KEY;
  const core = new JevDecisionCore(new JevClient(jevKey ? { apiKey: jevKey } : {}), audit);
  const executionId = `plan-${randomUUID()}`;
  const plan = await planPreflight({ executionId, issue: { id: issue.id, title: issue.title, ...(issue.description !== undefined ? { description: issue.description } : {}), acceptanceCriteria: issue.acceptanceCriteria, labels: issue.labels, hasScreenshot: hasScreenshot(issue), dependencies: issue.dependencies.map(dependency => ({ id: dependency.id, state: dependency.stateType })) }, verifiedModels, defaultRoute: config.config.defaultRoute }, core, audit);
  const output = formatPlan(plan);
  let commentWritten = false;
  if (plan.decisions.some(decision => decision.choice !== "uncertain" && (decision.escalated || decision.kind === "readiness" && decision.choice === "blocked"))) {
    await client.apply({ kind: "comment", id: commentId(issue.id), issueId: issue.id, body: output });
    commentWritten = true;
  }
  store.close();
  return { plan, output, commentWritten };
}
