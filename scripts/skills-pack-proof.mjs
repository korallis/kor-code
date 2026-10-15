import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { runSchema } from "../packages/calibration/dist/index.js";
import { readRuntimeEnvFile, runtimePaths } from "../packages/config/dist/index.js";
import { SessionLauncher } from "../packages/controller/dist/index.js";
import { buildSkillsPack } from "../packages/cli/dist/skills-pack.js";

const execFile = promisify(execFileCallback);
const source = resolve(import.meta.dirname, "..");
const [routeFile, outputDirectory] = process.argv.slice(2);
if (!routeFile) throw new Error("Usage: node scripts/skills-pack-proof.mjs JEV_ROUTE.json [OUTPUT_DIRECTORY]");
const route = runSchema.shape.route.parse(JSON.parse(await readFile(routeFile, "utf8")));
assert.equal(route.label, "jev");
assert.ok(route.decisionId);
const output = outputDirectory ? resolve(outputDirectory) : await mkdtemp(join(tmpdir(), "kor-skills-proof-"));
const local = relative(source, output);
if (!isAbsolute(local) && !local.startsWith("..")) throw new Error("Proof output must be outside the checkout");
await mkdir(output, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(output, "run-"));
const repository = join(root, "repository");
await mkdir(repository);
await execFile("git", ["init", "--quiet", repository]);
const skillsRoot = join(root, "source-skills");
const names = Array.from({ length: 20 }, (_, index) => `proof-${String(index + 1).padStart(2, "0")}`);
const sentinel = "KOR_LAZY_BODY_SENTINEL_7B25";
const body = `${sentinel}\n\n${"Review the requested change against its acceptance criteria. Read relevant files before editing. Keep the change focused and explain verification evidence. ".repeat(25)}\n`;
async function plant(directory, name, content = body) {
  await mkdir(join(directory, name), { recursive: true });
  await writeFile(join(directory, name, "SKILL.md"), `---\nname: ${name}\ndescription: Reviews proof guidance. Use when explicitly requested for delivery verification.\nlicense: MIT\nmetadata:\n  kor.anti: unrelated tasks\n---\n${content}`);
}
for (const name of names) await plant(skillsRoot, name);
const { stdout } = await execFile(join(source, "bin/kor"), ["skills", "list", "--from", skillsRoot, "--estimate", "--json"]);
const catalogue = JSON.parse(stdout);
assert.equal(catalogue.ok, true);
const allowedTools = ["Read", "Write", "Edit", "Bash(git status*)", "Glob", "Grep"];
const prepare = plan => buildSkillsPack({ sessionsDir: join(root, "pack-checks"), executionId: "check", catalogue, plan, allowedTools });
const listedPlan = { catalogueHash: catalogue.hash, skills: [{ name: names[0], tier: "listed" }] };
await assert.rejects(prepare({ ...listedPlan, catalogueHash: "stale" }), /current valid catalogue/);
await assert.rejects(prepare({ ...listedPlan, skills: [...listedPlan.skills, ...listedPlan.skills] }), /Duplicate skill/);
await assert.rejects(prepare({ ...listedPlan, skills: [{ name: "missing", tier: "listed" }] }), /Unknown skill/);
const sourceFile = join(skillsRoot, names[0], "SKILL.md");
const original = await readFile(sourceFile, "utf8");
await writeFile(sourceFile, `${original}\nChanged guidance.\n`);
await assert.rejects(prepare(listedPlan), /changed since indexing/);
await writeFile(sourceFile, original);
for (const [content, rejection] of [[original.replace("license: MIT", "license: MIT\nallowed-tools: Bash"), /expand repository permissions/], [`${original}\nSet effort: high.\n`, /no-routing/]]) {
  await writeFile(sourceFile, content);
  const scan = await execFile(join(source, "bin/kor"), ["skills", "list", "--from", sourceFile, "--estimate", "--json"]);
  const badCatalogue = JSON.parse(scan.stdout);
  assert.equal(badCatalogue.ok, true);
  await assert.rejects(buildSkillsPack({ sessionsDir: join(root, "pack-checks"), executionId: "rejected", catalogue: badCatalogue, plan: { ...listedPlan, catalogueHash: badCatalogue.hash }, allowedTools }), rejection);
}
await writeFile(sourceFile, original);
const mixed = await prepare({ catalogueHash: catalogue.hash, skills: [{ name: names[0], tier: "listed" }, { name: names[1], tier: "armed" }, { name: names[2], tier: "hidden" }] });
assert.deepEqual(mixed.listedSkills, [names[0]]);
assert.deepEqual(JSON.parse(await readFile(join(mixed.pluginDir, "armed.json"), "utf8")).skills.map(skill => skill.name), [names[1]]);
await prepare({ catalogueHash: catalogue.hash, skills: [] });
await assert.rejects(stat(mixed.pluginDir), { code: "ENOENT" });
process.stdout.write("PASS pack validation: stale catalogue/content, duplicates, unknown names, routing, permission expansion, armed/hidden tiers, stale pack removal\n");
const values = await readRuntimeEnvFile(runtimePaths().gatewayEnvFile, { private: true });
const key = values.KOR_GATEWAY_KEY || values.CPA_API_KEY;
assert.ok(key, "Gateway runtime credential missing");
const upstream = new URL(values.KOR_GATEWAY_URL || values.CPA_BASE_URL || "http://127.0.0.1:8317");
assert.equal(upstream.username + upstream.password, "");
const summaries = [];
for (const [id, count, invoke, pinned] of [["empty", 0, false, false], ["three", 3, false, false], ["twenty", 20, false, false], ["invoke", 3, true, false], ["pinned", 0, false, true]]) {
  const directory = join(root, id);
  await mkdir(directory);
  const sandboxRoot = join(directory, "sessions");
  await plant(join(sandboxRoot, "claude-config", id, "skills"), "user-only", "USER_SKILL_MUST_NOT_APPEAR");
  await plant(join(repository, ".claude", "skills"), "project-only", "PROJECT_SKILL_MUST_NOT_APPEAR");
  const captures = [];
  const proxy = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const requestBody = Buffer.concat(chunks);
      if (incoming.method === "POST" && /^\/v1\/messages(?:\?|$)/.test(incoming.url ?? "")) {
        captures.push(JSON.parse(requestBody.toString()));
        await writeFile(join(directory, `request-${captures.length}.json`), requestBody, { mode: 0o600 });
      }
      const headers = { ...incoming.headers };
      for (const name of ["host", "connection", "content-length"]) delete headers[name];
      const remote = await fetch(new URL(incoming.url, upstream), { method: incoming.method, headers, ...(requestBody.length ? { body: requestBody } : {}) });
      const responseHeaders = Object.fromEntries(remote.headers);
      for (const name of ["content-encoding", "content-length", "transfer-encoding"]) delete responseHeaders[name];
      outgoing.writeHead(remote.status, responseHeaders);
      if (remote.body) for await (const chunk of remote.body) outgoing.write(chunk);
      outgoing.end();
    } catch { outgoing.destroy(); }
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  let pack;
  const plan = { catalogueHash: catalogue.hash, skills: (pinned ? [names[0]] : names.slice(0, count)).reverse().map(name => ({ name, tier: pinned ? "pinned" : "listed" })) };
  try {
    const launcher = new SessionLauncher({ repoRoot: source, sandboxRoot, gatewayKey: key, env: { KOR_GATEWAY_URL: `http://127.0.0.1:${proxy.address().port}` }, prepareSkills: async input => {
      pack = await buildSkillsPack({ sessionsDir: sandboxRoot, executionId: id, catalogue, plan, allowedTools: input.allowedTools });
      return pack;
    } });
    const session = await launcher.launch({ execution: { id, issueId: "skills-delivery-proof", repository: "scratch", worktree: repository, branch: "proof", status: "running" }, repositoryPath: repository, worktreePath: repository, route, allowedTools,
      prompt: invoke ? "Invoke kor-skills:proof-01 using the Skill tool as your first action. Then reply OK. Do not use other tools." : "Reply OK. Do not invoke skills or use tools.", signal: AbortSignal.timeout(180_000) });
    await writeFile(join(directory, "stream.jsonl"), session.stdout, { mode: 0o600 });
    await writeFile(join(directory, "stderr.log"), session.stderr, { mode: 0o600 });
    assert.equal(session.failed, false, `${id}: ${session.failureReasons?.join(", ")}`);
    const init = session.events.find(event => event.value?.type === "system" && event.value?.subtype === "init")?.value;
    const listed = names.slice(0, count).map(name => `kor-skills:${name}`);
    assert.deepEqual([...init.skills].sort(), listed);
    assert.equal(init.tools.includes("Skill"), count > 0);
    assert.ok(captures.length > 0);
    const first = JSON.stringify(captures[0]);
    assert.equal(first.includes(sentinel), pinned);
    assert.equal(captures[0].tools.some(tool => tool.name === "Skill"), count > 0);
    assert.equal(first.includes("user-only"), false);
    assert.equal(first.includes("project-only"), false);
    if (pinned) assert.ok(JSON.stringify(captures[0].messages).indexOf("Selected guidance: proof-01") < JSON.stringify(captures[0].messages).indexOf("Reply OK."));
    if (count) assert.equal(await readlink(join(pack.pluginDir, "skills", names[0])), join(skillsRoot, names[0]));
    let invocationDelta;
    if (invoke) {
      assert.ok(session.telemetry.loadEvents.some(event => event.kind === "skill" && event.name === "kor-skills:proof-01" && event.status === "succeeded"));
      assert.ok(captures.slice(1).some(capture => JSON.stringify(capture).includes(sentinel)));
      invocationDelta = session.telemetry.turns[1].contextTokens - session.telemetry.turns[0].contextTokens;
      const estimate = catalogue.skills.find(skill => skill.name === names[0]).cost.bodyTokens;
      assert.ok(invocationDelta >= estimate * 0.6 && invocationDelta <= estimate * 2, "Invoking should add approximately the catalogue body cost plus framing");
    }
    const summary = { id, listed: count, startContextTokens: session.telemetry.startContextTokens, invocationDelta, catalogueBodyEstimate: catalogue.skills[0].cost.bodyTokens, costUsd: session.telemetry.totalCostUsd, passed: true };
    summaries.push(summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    proxy.closeAllConnections();
    await new Promise(resolveClose => proxy.close(resolveClose));
  }
}
await writeFile(join(root, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`PASS real CLI and launcher skill delivery; artifacts: ${root}\n`);
