import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { JevClient, JevDecisionCore, JevUnavailableError, MemoryDecisionAuditLog, responseSchema, skillCandidateSchema, type JevQuestion, type JevResponse } from "../packages/jev/src/index.js";

const fixturePath = new URL("./fixtures/skills.json", import.meta.url);
const taskSchema = z.object({ id: z.string(), task: z.string(), stage: z.string(), expected: z.string(), responses: z.array(responseSchema).default([]) });
const schema = z.object({ catalogue: z.object({ hash: z.string(), skills: z.array(skillCandidateSchema) }), tasks: z.array(taskSchema) });
const fixture = schema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
assert.equal(fixture.tasks.length, 23);
const live = process.argv.includes("--live-jev") || process.argv.includes("--record");
const record = process.argv.includes("--record");
const liveClient = new JevClient();
let top1 = 0, top3 = 0, changed = 0, maxTokens = 0, inputTokens = 0, outputTokens = 0;
const latencies: number[] = [];
for (const task of fixture.tasks) {
  let calls = 0;
  const responses: JevResponse[] = [];
  const client = { async evaluate(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
    const id = Object.keys(questions)[0]!;
    const response = live ? await liveClient.evaluate(state, questions) : task.responses.find(response => Object.hasOwn(response.answers, id));
    if (!response) throw new Error(`Missing recorded response for ${task.id}`);
    calls++;
    responses.push(response);
    return response;
  } };
  const input = { executionId: task.id, task: task.task, stage: task.stage, catalogue: fixture.catalogue, allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"], budget: 4_000 };
  const audit = new MemoryDecisionAuditLog();
  const core = new JevDecisionCore(client, audit);
  const result = await core.selectSkills(input);
  const ranked = Object.entries(result.probabilities ?? {}).sort(([a, pa], [b, pb]) => pb - pa || a.localeCompare(b)).map(([name]) => name);
  top1 += Number(result.choice === task.expected);
  top3 += Number(ranked.slice(0, 3).includes(task.expected));
  assert.equal(result.plan.source, "jev");
  assert.ok(result.plan.tokens.total <= result.plan.budget);
  assert.equal(result.plan.tokens.total, result.plan.tokens.pinned + result.plan.tokens.listed + result.plan.tokens.tool);
  assert.equal(result.plan.skills.length, fixture.catalogue.skills.length);
  if (result.plan.selection.calls) {
    assert.equal(result.plan.selection.calls, 2);
    assert.notDeepEqual(result.plan.selection.samples[0]?.order, result.plan.selection.samples[1]?.order);
  }
  const imported = new MemoryDecisionAuditLog();
  imported.importSerialized(audit.serialize());
  assert.deepEqual(imported.replay(result.decisionId), result);
  assert.deepEqual(imported.explain(result.decisionId).response.plan, result.plan);
  assert.deepEqual(await core.selectSkills(input), result);
  assert.equal(calls, result.plan.selection.calls);
  if (live && !record) {
    const recorded = new JevDecisionCore({ evaluate: async (_state, questions) => task.responses.find(response => Object.hasOwn(response.answers, Object.keys(questions)[0]!))! });
    changed += Number((await recorded.selectSkills(input)).choice !== result.choice);
  }
  maxTokens = Math.max(maxTokens, result.plan.tokens.total);
  inputTokens += result.plan.selection.inputTokens;
  outputTokens += result.plan.selection.outputTokens;
  latencies.push(...result.plan.selection.callDurationMs);
  if (record) task.responses = responses.sort((a, b) => Object.keys(a.answers)[0]!.localeCompare(Object.keys(b.answers)[0]!));
  console.log(`${task.id}: ${result.choice}; expected=${task.expected}; rank=${ranked.indexOf(task.expected) + 1}; tokens=${result.plan.tokens.total}/${result.plan.budget}`);
}
const outageAudit = new MemoryDecisionAuditLog();
const outage = new JevDecisionCore({ evaluate: async () => { throw new JevUnavailableError("Recorded outage"); } }, outageAudit);
const fallback = await outage.selectSkills({ executionId: "outage", task: "Edit the implementation", stage: "execute", catalogue: fixture.catalogue, allowedTools: ["Read", "Bash"], always: ["human-written-code"] });
assert.equal(fallback.plan.source, "fallback");
assert.deepEqual(fallback.plan.skills.filter(skill => skill.tier !== "hidden").map(skill => skill.name), ["human-written-code"]);
assert.deepEqual(outage.replay(fallback.decisionId), fallback);
if (record) await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
const median = latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] ?? 0;
console.log(`skills fixture: mode=${live ? "live" : "recorded"}; top1=${top1}/23; top3=${top3}/23; changed=${changed}; maxSkillTokens=${maxTokens}/4000; JevInputTokens=${inputTokens}; JevOutputTokens=${outputTokens}; medianCallMs=${median.toFixed(1)}; fallback=always-only; replay=identical`);
assert.ok(top1 / 23 >= 0.85, "Top-1 accuracy is below 85%");
assert.equal(top3, 23, "Expected skill missing from top three");
if (live && !record) assert.ok(changed <= 1, "Live selection differs by more than one task");
