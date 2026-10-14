import { createHash, randomUUID } from "node:crypto";
import { resolveLinearApiKey } from "@kor-code/linear";
import { HttpLinearClient } from "@kor-code/linear";
import { LinearStore } from "@kor-code/linear";
import { JevClient, JevDecisionCore, PersistentDecisionAuditLog, planPreflight, type PreflightPlan } from "@kor-code/jev";
import { readModelRegistry } from "@kor-code/gateway-adapter";
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
    lines.push(`${decision.kind}: ${value}; confidence=${decision.confidence.toFixed(2)}; status=${decision.applied ? "applied" : "blocked"}`);
  }
  return lines.join("\n");
}
export async function runPlan(issueId: string, environment: NodeJS.ProcessEnv = process.env): Promise<{ plan: PreflightPlan; output: string; commentWritten: boolean }> {
  if (!/^([A-Z][A-Z0-9]+)-[0-9]+$/.test(issueId)) throw new Error("Plan requires a Linear issue identifier such as LEE-57");
  const paths = runtimePaths(environment);
  const config = await loadKorConfig(paths.configFile, { home: paths.home });
  const apiKey = await resolveLinearApiKey();
  const client = new HttpLinearClient({ apiKey, writes: {} });
  const issue = await client.getIssue(issueId);
  const registry = await readModelRegistry(paths.modelsFile);
  const verifiedModels = registry.models.filter(result => result.verified).map(result => ({ provider: result.model.split("/")[0] ?? "unknown", model: result.model, capabilities: Object.entries(result.capabilities).map(([name, supported]) => ({ name, supported })) }));
  const store = new LinearStore(paths.databaseFile);
  const audit = new PersistentDecisionAuditLog({ read: decisionId => store.readDecisionAudit(decisionId), write: (decisionId, recordedAt, payload) => store.writeDecisionAudit(decisionId, recordedAt, payload) });
  const jevKey = environment.TYPESAFE_API_KEY ?? environment.TYPESAFE_KEY ?? environment.JEV_API_KEY;
  const core = new JevDecisionCore(new JevClient(jevKey ? { apiKey: jevKey } : {}), audit);
  const executionId = `plan-${randomUUID()}`;
  const plan = await planPreflight({ executionId, issue: { id: issue.id, title: issue.title, ...(issue.description !== undefined ? { description: issue.description } : {}), acceptanceCriteria: issue.acceptanceCriteria, dependencies: issue.dependencies.map(dependency => ({ id: dependency.id, state: dependency.stateType })) }, verifiedModels, defaultRoute: config.config.defaultRoute }, core, audit);
  const output = formatPlan(plan);
  let commentWritten = false;
  if (plan.decisions.some(decision => decision.escalated || decision.kind === "readiness" && decision.choice === "blocked")) {
    await client.apply({ kind: "comment", id: commentId(issue.id), issueId: issue.id, body: output });
    commentWritten = true;
  }
  store.close();
  return { plan, output, commentWritten };
}
