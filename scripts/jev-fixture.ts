import type { JevQuestion, JevResponse, DecisionRequest } from "../packages/jev/src/index.js";
import { JevDecisionCore, MemoryDecisionAuditLog } from "../packages/jev/src/index.js";
import type { JsonValue } from "@kor-code/core";

let calls = 0;
const fake = { async evaluate(_state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
  calls += 1;
  const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    if (question.type === "noul") return [id, { type: "noul", noul: 0.91 }];
    if (question.type === "score") return [id, { type: "score", score: 0.91, confidence: 0.88, probabilities: { "0": 0.09, "1": 0.91 }, legend: { "0": String(question.criteria[0]), "1": String(question.criteria[1]) } }];
    return [id, { type: "choice", choice: question.criteria["single-agent"] === null ? "single-agent" : Object.keys(question.criteria)[0]!, confidence: id === "fixture-context" ? 0.42 : 0.93, probabilities: Object.fromEntries(Object.keys(question.criteria).map(candidate => [candidate, candidate === "single-agent" ? 0.93 : 0.07])) }];
  }));
  return { model: "fixture-jev", answers } as JevResponse;
} };
const audit = new MemoryDecisionAuditLog();
const core = new JevDecisionCore(fake, audit, () => "2026-10-13T00:00:00.000Z");
const requests: DecisionRequest[] = ["route", "skill", "agent", "context"].map(kind => ({ decisionId: `fixture-${kind}`, executionId: "exec-fixture", kind: kind as DecisionRequest["kind"], question: "Which execution plan fits?", state: { task: "small bounded change" }, inputs: [{ name: "acceptance", value: "passes" }], candidates: ["single-agent", "parallel-specialists"] }));
const applied = (await core.preflight(requests)).decisions;
const directKinds = applied.map(decision => decision.kind).join(",");
const noulScore = await fake.evaluate({ task: "typed questions" }, { ready: { type: "noul", instructions: "Is this ready?" }, risk: { type: "score", instructions: "Rate risk", criteria: ["low", "high"] } });
const explained = applied.map(decision => core.explain(decision.decisionId));
const persisted = new MemoryDecisionAuditLog();
persisted.importSerialized(audit.serialize());
const beforeReplay = calls;
const replayed = applied.map(decision => persisted.replay(decision.decisionId));
if (calls !== beforeReplay || JSON.stringify(replayed) !== JSON.stringify(applied) || explained.length !== applied.length || directKinds !== "route,skill,agent,context" || !noulScore.answers.ready || !noulScore.answers.risk || applied.at(-1)?.escalated !== true) throw new Error("audit replay proof failed");
console.log(`jev fixture: applied=${applied.length}; kinds=${directKinds}; explained=${explained.length}; replayed=${replayed.length}; typed=noul,score; lowConfidenceEscalated=yes; jevCalls=${calls}; replayCalls=0; identical=yes`);
