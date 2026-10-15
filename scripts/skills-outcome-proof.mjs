import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { CalibrationStore, buildSkillsReport, metricFromSession, runSchema } from "../packages/calibration/dist/index.js";
import { JevDecisionCore } from "../packages/jev/dist/index.js";
import { buildSkillsPack } from "../packages/cli/dist/skills-pack.js";

const execFile = promisify(execFileCallback);
const source = resolve(import.meta.dirname, "..");
const [routeFile, outputDirectory] = process.argv.slice(2);
if (!routeFile) throw new Error("Usage: node scripts/skills-outcome-proof.mjs JEV_ROUTE.json [OUTPUT_DIRECTORY]");
const route = runSchema.shape.route.parse(JSON.parse(await readFile(routeFile, "utf8")));
assert.equal(route.label, "jev");
const output = outputDirectory ? resolve(outputDirectory) : await mkdtemp(join(tmpdir(), "kor-skills-outcomes-"));
const local = relative(source, output);
if (!isAbsolute(local) && !local.startsWith("..")) throw new Error("Proof output must be outside the checkout");
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = JSON.parse(await readFile(join(source, "scripts/fixtures/skills.json"), "utf8"));
const { stdout } = await execFile(join(source, "bin/kor"), ["skills", "list", "--estimate", "--json"], { env: { ...process.env, XDG_CONFIG_HOME: join(output, "config") } });
const actual = JSON.parse(stdout);
assert.equal(actual.ok, true);
const catalogue = { hash: actual.hash, skills: fixture.catalogue.skills.map(skill => ({ ...skill, hash: actual.skills.find(row => row.name === skill.name)?.hash })) };
const allowedTools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
const now = new Date().toISOString();
const tools = [...allowedTools].sort();
const open = name => new CalibrationStore(join(output, name, "kor", "kor.db"));
const inputFor = (task, executionId) => ({ executionId, task: task.task, stage: task.stage, catalogue, allowedTools });
const coreFor = (task, store) => new JevDecisionCore({ evaluate: async (_state, questions) => {
  const response = task.responses.find(response => Object.hasOwn(response.answers, Object.keys(questions)[0]));
  if (!response) throw new Error("Recorded answer missing");
  return response;
} }, store);
function record(store, id, decision, { status = "verified", used = false, pair = false } = {}) {
  store.beginRun({ executionId: id, pairId: id, issueId: id, arm: "jev", baseRevision: "replayed", route, sampled: pair, startedAt: now, status: "running" });
  const loadEvents = used ? [{ kind: "skill", name: `kor-skills:${decision.choice}`, toolUseId: id, turn: 1, status: "succeeded" }] : [];
  store.recordAttempt(metricFromSession({ executionId: id, attempt: 1, route, startedAt: now, finishedAt: now, session: { skillDecisionId: decision.decisionId, tools, telemetry: { permissionDenials: 0, loadEvents, totalCostUsd: 0.02 } }, verified: status === "verified" }));
  store.finishRun(id, status);
  store.recordExecutionOutcome(id, { status: status === "verified" ? "merged" : "rejected", recordedAt: now, source: "labelled-proof-replay" });
  if (pair) {
    const baseline = `${id}-skills-baseline`;
    store.beginRun({ executionId: baseline, pairId: `${id}-skills`, purpose: "skills", issueId: id, arm: "baseline", baseRevision: "replayed", route, sampled: true, startedAt: now, status: "running" });
    store.recordAttempt(metricFromSession({ executionId: baseline, attempt: 1, route, startedAt: now, finishedAt: now, session: { tools, telemetry: { permissionDenials: 0, loadEvents: [], totalCostUsd: 0.01 } }, verified: true }));
    store.finishRun(baseline, "verified");
  }
}
const replay = open("replay");
for (const task of fixture.tasks) {
  const decision = await coreFor(task, replay).selectSkills(inputFor(task, task.id));
  record(replay, task.id, decision, { pair: true, used: true });
}
const replayReport = buildSkillsReport(replay);
assert.ok(replayReport.skills.length > 0);
assert.ok(replayReport.skills.every(skill => skill.offered > 0 && skill.samples > 0));
await writeFile(join(output, "replay-report.json"), JSON.stringify(replayReport, null, 2));
console.log(`Recorded 23-task replay: ${replayReport.skills.length} skill rows, ${replayReport.skills.reduce((sum, skill) => sum + skill.offered, 0)} offers`);
replay.close();

const store = open("boundary");
const task = fixture.tasks[0];
const core = coreFor(task, store);
const learningFor = report => Object.fromEntries(report.skills.map(skill => [skill.name, { samples: skill.samples, offered: skill.offered, loaded: skill.loaded, used: skill.used, passRate: skill.passRate, lift: skill.pairs >= 20 ? skill.lift : null, demoted: skill.demoted, thresholds: skill.thresholds }]));
for (let index = 1; index <= 20; index++) {
  const id = `unloaded-${index}`;
  const decision = await core.selectSkills({ ...inputFor(task, id), bodyBudget: 0 });
  record(store, id, decision, { status: "failed", pair: true });
  if (index === 19) {
    const report = buildSkillsReport(store);
    assert.equal(report.skills[0].samples, 19);
    assert.equal(report.skills[0].demoted, false);
    assert.deepEqual(report.skills[0].thresholds, { pinned: 0.8, listed: 0.25, armed: 0.15 });
    const input = { ...inputFor(task, "below-minimum"), bodyBudget: 0 };
    const before = await core.selectSkills(input);
    const after = await core.selectSkills({ ...input, learning: learningFor(report) });
    assert.deepEqual(after, before);
    const pack = await buildSkillsPack({ sessionsDir: join(output, "packs"), executionId: "demotion", catalogue: actual, plan: before.plan, allowedTools });
    assert.ok(pack.listedSkills.includes(task.expected));
    console.log("19 samples: identical decision ID and plan; thresholds unchanged; skill present in pack");
  }
}
const report = buildSkillsReport(store);
const stats = report.skills.find(skill => skill.name === task.expected);
assert.equal(stats.samples, 20);
assert.equal(stats.pairs, 20);
assert.equal(stats.demoted, true);
assert.equal(stats.loaded, 0);
assert.equal(stats.lift, -1);
assert.equal(stats.thresholds.pinned, 1);
assert.equal(stats.reliability.at(-1).n, 20);
const decision = await core.selectSkills({ ...inputFor(task, "demoted"), bodyBudget: 0, learning: learningFor(report) });
assert.equal(decision.plan.skills.find(skill => skill.name === task.expected).tier, "hidden");
const pack = await buildSkillsPack({ sessionsDir: join(output, "packs"), executionId: "demotion", catalogue: actual, plan: decision.plan, allowedTools });
assert.deepEqual(pack.listedSkills, []);
assert.equal(pack.pluginDir, undefined);
const pinned = await core.selectSkills({ ...inputFor(task, "explicit-pin"), pins: [task.expected], learning: learningFor(report) });
assert.equal(pinned.plan.skills.find(skill => skill.name === task.expected).tier, "pinned");
assert.ok(core.explain(pinned.decisionId).request.state.history[task.expected]);
store.close();
const env = { ...process.env, XDG_STATE_HOME: join(output, "boundary"), XDG_CONFIG_HOME: join(output, "config") };
const cli = await execFile(join(source, "bin/kor"), ["skills", "report"], { env });
assert.match(cli.stdout, /demoted/);
const json = await execFile(join(source, "bin/kor"), ["skills", "report", "--json"], { env });
assert.equal(JSON.parse(json.stdout).skills[0].demoted, true);
await writeFile(join(output, "boundary-report.txt"), cli.stdout);
console.log(cli.stdout);
console.log("20 samples: reliability recalibrated; demoted skill removed from pack and CLI reports it; explicit pin retained with history as state");
console.log("Proof uses recorded Jev responses with labelled synthetic telemetry and outcomes; these are not live quality or cost measurements.");
