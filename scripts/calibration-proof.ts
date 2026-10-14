import { rm } from "node:fs/promises";
import { join } from "node:path";
import { CalibrationStore, buildReport, formatReport, metricSchema, sampledPair, type CalibrationRun, type RunOutcome } from "../packages/calibration/src/index.js";
import type { Route } from "../packages/core/src/index.js";
import { JevDecisionCore } from "../packages/jev/src/index.js";

const root = process.env.KOR_CALIBRATION_PROOF_DIR ?? "/tmp/kor-t12-calibration-proof";
await rm(root, { recursive: true, force: true });
const store = new CalibrationStore(join(root, "state", "kor", "kor.db"));
const route: Route = { provider: "anthropic", model: "claude-sonnet-5-5", accountPolicy: "fill-first", sessionAffinity: true, reasoningLevel: "medium" };
const jev = new JevDecisionCore({ evaluate: async () => ({ model: "proof", answers: {} }) }, store);
function run(executionId: string, pairId: string, arm: CalibrationRun["arm"], costUsd: number, verified: boolean): void {
  const startedAt = new Date("2026-10-14T10:00:00.000Z").toISOString();
  store.beginRun({ executionId, pairId, issueId: `LEE-${pairId}`, arm, baseRevision: "abc123", route, sampled: true, startedAt, status: "running" });
  store.recordAttempt(metricSchema.parse({ executionId, attempt: 1, recordedAt: "2026-10-14T10:00:02.000Z", model: route.model, costUsd, inputTokens: 100, outputTokens: 50, cacheReadTokens: 50, cacheCreationTokens: 10, wallClockMs: 2_000, sessionDurationMs: 1_900, failovers: 0, apiErrorStatus: null, policyBlocks: 0, clarifications: 0, verificationFailures: verified ? 0 : 1, verified, findings: [] }));
  store.finishRun(executionId, verified ? "verified" : "failed");
  jev.apply({ decisionId: `route-${executionId}`, executionId, kind: "route", question: "Select the route.", state: { issueId: pairId }, inputs: [], candidates: [route.model, "claude-haiku-5-5"] }, { type: "choice", choice: route.model, confidence: arm === "jev" ? 0.8 : 0.6, probabilities: { [route.model]: arm === "jev" ? 0.9 : 0.7, "claude-haiku-5-5": arm === "jev" ? 0.1 : 0.3 } });
  const outcome: RunOutcome = { status: verified ? "merged" : "rejected", recordedAt: "2026-10-14T10:01:00.000Z", source: "calibration-proof" };
  store.recordExecutionOutcome(executionId, outcome, jev);
}
run("proof-jev", "pair-1", "jev", 0.04, true);
run("proof-baseline", "pair-1", "baseline", 0.06, false);
if (!sampledPair("proof-jev", 1) || store.beginRun({ executionId: "proof-baseline", pairId: "pair-1", issueId: "LEE-pair-1", arm: "baseline", baseRevision: "abc123", route, sampled: true, startedAt: "2026-10-14T10:00:00.000Z", status: "running" })) throw new Error("Calibration idempotence or sampling proof failed");
process.stdout.write("calibration:proof passed; sampled=true; replay=paired; duplicate_baseline=ignored\n\n");
process.stdout.write(`${formatReport(buildReport(store))}\n`);
store.close();
process.stdout.write(`proof_state=${root}\n`);
