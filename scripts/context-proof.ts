import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { CalibrationStore, buildReport, formatReport, metricFromSession } from "../packages/calibration/src/index.js";
import { SessionLauncher } from "../packages/controller/src/launcher.js";

const execFile = promisify(execFileCallback);
const root = await mkdtemp(join(tmpdir(), "kor-context-proof-"));
const replay = join(root, "replay.sh");
await writeFile(replay, 'cat -- "$2"\n');
// Usage recorded by the live contributor-note bench; content and IDs sanitized.
const recorded = [
  {"type":"assistant","message":{"id":"turn-1","usage":{"input_tokens":2,"cache_creation_input_tokens":41348,"cache_read_input_tokens":0,"output_tokens":3},"content":[]}},
  {"type":"assistant","message":{"id":"turn-1","usage":{"input_tokens":2,"cache_creation_input_tokens":41348,"cache_read_input_tokens":0,"output_tokens":3},"content":[{"type":"tool_use","id":"call-1","name":"Read","input":{}}]}},
  {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call-1","content":"[omitted]","is_error":false}]}},
  {"type":"assistant","message":{"id":"turn-2","usage":{"input_tokens":2,"cache_creation_input_tokens":946,"cache_read_input_tokens":41348,"output_tokens":2},"content":[]}},
  {"type":"assistant","message":{"id":"turn-2","usage":{"input_tokens":2,"cache_creation_input_tokens":946,"cache_read_input_tokens":41348,"output_tokens":2},"content":[{"type":"tool_use","id":"call-2","name":"Write","input":{}}]}},
  {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"call-2","content":"[omitted]","is_error":false}]}},
  {"type":"assistant","message":{"id":"turn-3","usage":{"input_tokens":2,"cache_creation_input_tokens":459,"cache_read_input_tokens":42294,"output_tokens":4},"content":[]}},
  {"total_cost_usd":0.1288229,"usage":{"input_tokens":6,"cache_creation_input_tokens":42753,"cache_read_input_tokens":83642,"output_tokens":520,"output_tokens_details":{"thinking_tokens":30},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":42753},"inference_geo":"global","iterations":[],"speed":"standard","fallback_credit":null},"is_error":false,"num_turns":3,"type":"result","result":"[omitted]"},
];
const stream = join(root, "recorded.jsonl");
await writeFile(stream, recorded.map(event => JSON.stringify(event)).join("\n"));
const launcher = new SessionLauncher({ sandboxScript: replay, args: [stream], sandboxRoot: join(root, "sandbox") });
const execution = { id: "recording", issueId: "context-proof", repository: "scratch", worktree: root, branch: "proof", status: "running" as const };
const session = await launcher.launch({ execution, repositoryPath: root, worktreePath: root, prompt: "Replay" });
assert.equal(session.failed, false);
const telemetry = session.telemetry;
assert.equal(telemetry?.startContextTokens, 41350);
assert.equal(telemetry?.contextTokenSum, 126401);
assert.deepEqual(telemetry?.turns?.map(turn => [turn.contextTokens, turn.cacheReadTokens, turn.outputTokens]), [[41350, 0, 3], [42296, 41348, 2], [42755, 42294, 4]]);
assert.equal(telemetry?.loadEvents?.length, 2);
process.stdout.write(`Recorded stream: start context=${telemetry.startContextTokens}; context sum=${telemetry.contextTokenSum}\n`);
for (const [index, turn] of (telemetry.turns ?? []).entries()) process.stdout.write(`Turn ${index + 1}: context=${turn.contextTokens}; cache reads=${turn.cacheReadTokens}; cache creation=${turn.cacheCreationTokens}\n`);

// Additional protocol cases exercise skill loads and child messages.
const edgeCases = [
  { type: "assistant", message: { id: "turn-1", usage: { input_tokens: 2, cache_creation_input_tokens: 27037, cache_read_input_tokens: 0, output_tokens: 20 }, content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "skills/linear/SKILL.md" } }] } },
  { type: "assistant", message: { id: "turn-1", usage: { input_tokens: 2, cache_creation_input_tokens: 27037, cache_read_input_tokens: 0, output_tokens: 40 }, content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "skills/linear/SKILL.md" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "Loaded skill" }] } },
  { type: "assistant", parent_tool_use_id: "agent-1", message: { id: "child", usage: { input_tokens: 900, output_tokens: 10 }, content: [] } },
  { type: "assistant", message: { id: "turn-2", usage: { input_tokens: 397, cache_creation_input_tokens: 0, cache_read_input_tokens: 27037, output_tokens: 80 }, content: [{ type: "tool_use", id: "skill-1", name: "Skill", input: { skill: "example" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "skill-1", content: "Denied", is_error: true }] } },
  { type: "result", result: "Done", is_error: false, num_turns: 2, total_cost_usd: 0.076, usage: { input_tokens: 399, cache_creation_input_tokens: 27037, cache_read_input_tokens: 27037, output_tokens: 120 } },
];
await writeFile(stream, edgeCases.map(event => JSON.stringify(event)).join("\n"));
const edge = await launcher.launch({ execution, repositoryPath: root, worktreePath: root, prompt: "Replay edges" });
assert.equal(edge.telemetry?.contextTokenSum, 54473);
assert.equal(edge.telemetry?.loadEvents?.length, 4);
assert.deepEqual(edge.telemetry?.loadEvents?.filter(event => event.kind === "skill").map(event => event.status), ["succeeded", "failed"]);
await writeFile(stream, edgeCases.slice(0, -1).map(event => JSON.stringify(event)).join("\n"));
const partial = await launcher.launch({ execution, repositoryPath: root, worktreePath: root, prompt: "Replay partial" });
assert.equal(partial.failed, true);
assert.equal(partial.telemetry?.contextTokenSum, 54473);
assert.ok(partial.failureReasons?.includes("missing result event"));

const file = join(root, "kor", "kor.db");
await mkdir(join(root, "kor"));
const legacy = new DatabaseSync(file);
legacy.exec("CREATE TABLE run_metrics (execution_id TEXT NOT NULL, attempt INTEGER NOT NULL, recorded_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(execution_id, attempt))");
legacy.close();
const store = new CalibrationStore(file);
const route = { provider: "recording", model: "recording", accountPolicy: "fill-first" as const, sessionAffinity: true };
const time = new Date().toISOString();
for (const [arm, id] of [["jev", "recording"], ["baseline", "baseline-recording"]] as const) {
  store.beginRun({ executionId: id, pairId: "recording", issueId: "proof", arm, baseRevision: "recorded", route, sampled: true, startedAt: time, status: "running" });
  store.recordAttempt(metricFromSession({ executionId: id, attempt: 1, route, startedAt: time, finishedAt: time, session, verified: true }));
  store.finishRun(id, "verified");
}
const historicalId = "historical";
store.beginRun({ executionId: historicalId, pairId: historicalId, issueId: "proof", arm: "fallback", baseRevision: "recorded", route, sampled: false, startedAt: time, status: "failed" });
const { turns: _turns, loadEvents: _loads, startContextTokens: _start, contextTokenSum: _sum, ...historical } = metricFromSession({ executionId: historicalId, attempt: 1, route, startedAt: time, finishedAt: time, session, verified: false });
store.close();
const oldWriter = new DatabaseSync(file);
oldWriter.prepare("INSERT INTO run_metrics (execution_id, attempt, recorded_at, payload) VALUES(?,?,?,?)").run(historicalId, 1, time, JSON.stringify(historical));
oldWriter.close();
const reopened = new CalibrationStore(file);
assert.equal(reopened.metrics().find(metric => metric.executionId === "recording")?.contextTokenSum, 126401);
assert.deepEqual(reopened.metrics().find(metric => metric.executionId === "recording")?.turns, telemetry.turns);
assert.equal(reopened.metrics().find(metric => metric.executionId === historicalId)?.startContextTokens, null);
const report = buildReport(reopened);
assert.equal(report.pairedSampleSize, 1);
assert.match(report.note, /Directional/);
assert.deepEqual(report.arms.find(arm => arm.arm === "jev")?.context.startContextTokens, { value: 41350, n: 1 });
const db = new DatabaseSync(file);
assert.deepEqual({ ...db.prepare("SELECT start_context_tokens, context_token_sum FROM run_metrics LIMIT 1").get() }, { start_context_tokens: 41350, context_token_sum: 126401 });
db.close();
reopened.close();
const cli = await execFile(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", resolve("scripts/tsconfig.json"), resolve("scripts/kor.ts"), "calibrate", "report", "--context"], {
  env: { ...process.env, HOME: root, XDG_STATE_HOME: root },
});
assert.match(cli.stdout, /Context medians/);
assert.match(cli.stdout, /startContextTokens\t41350/);
process.stdout.write(`${formatReport(report, { context: true })}\nMigration and reopen: preserved per-turn values. Split messages counted once; child usage excluded.\n`);
