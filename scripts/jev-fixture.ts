import type { JevAnswer, JevQuestion, JevResponse, DecisionRequest } from "../packages/jev/src/index.js";
import { JevDecisionCore, MemoryDecisionAuditLog } from "../packages/jev/src/index.js";
import type { JsonValue } from "@kor-code/core";

let calls = 0;
const fake = { async evaluate(_state: JsonValue, questions: Record<string, JevQuestion>): Promise<JevResponse> {
  calls += 1;
  return { model: "fixture-jev", answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: "choice", choice: "single-agent", confidence: 0.93, probabilities: { "single-agent": 0.93, "parallel-specialists": 0.07 } } satisfies JevAnswer])) };
} };
const audit = new MemoryDecisionAuditLog();
const core = new JevDecisionCore(fake, audit, () => "2026-10-13T00:00:00.000Z");
const requests: DecisionRequest[] = ["route", "agent"].map(kind => ({ decisionId: `fixture-${kind}`, executionId: "exec-fixture", kind: kind as DecisionRequest["kind"], question: "Which execution plan fits?", state: { task: "small bounded change" }, inputs: [{ name: "acceptance", value: "passes" }], candidates: ["single-agent", "parallel-specialists"] }));
const applied = (await core.preflight(requests)).decisions;
const explained = applied.map(decision => core.explain(decision.decisionId));
const beforeReplay = calls;
const replayed = applied.map(decision => core.replay(decision.decisionId));
if (calls !== beforeReplay || JSON.stringify(replayed) !== JSON.stringify(applied) || explained.length !== applied.length) throw new Error("audit replay proof failed");
console.log(`jev fixture: applied=${applied.length}; explained=${explained.length}; replayed=${replayed.length}; jevCalls=${calls}; replayCalls=0; identical=yes`);
