import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { CalibrationStore, metricFromSession, runSchema } from "../packages/calibration/dist/index.js";
import { readRuntimeEnvFile, runtimePaths } from "../packages/config/dist/index.js";
import { SessionLauncher } from "../packages/controller/dist/index.js";
import { buildSkillsPack } from "../packages/cli/dist/skills-pack.js";

const execFile = promisify(execFileCallback);
const source = resolve(import.meta.dirname, "..");
const [routeFile, outputDirectory] = process.argv.slice(2);
if (!routeFile) throw new Error("Usage: node scripts/skills-pack-proof.mjs JEV_ROUTE.json [OUTPUT_DIRECTORY] [--arming-only|--subagent-only]");
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
  const trigger = { "proof-01": "file:src/first.ts", "proof-02": "command:git status", "proof-03": "file:src/third.ts" }[name];
  await writeFile(join(directory, name, "SKILL.md"), `---\nname: ${name}\ndescription: Reviews proof guidance. Use when explicitly requested for delivery verification.\nlicense: MIT\nmetadata:\n  kor.anti: unrelated tasks\n${trigger ? `  kor.triggers: '${trigger}'\n` : ""}---\n${content}\nKOR_SKILL_MARKER_${name}\n`);
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
await writeFile(sourceFile, `${original}\n${"Check the requested change. ".repeat(300)}\n`);
const oversized = JSON.parse((await execFile(join(source, "bin/kor"), ["skills", "list", "--from", sourceFile, "--estimate", "--json"])).stdout);
await assert.rejects(buildSkillsPack({ sessionsDir: join(root, "pack-checks"), executionId: "oversized", catalogue: oversized, plan: { catalogueHash: oversized.hash, skills: [{ name: names[0], tier: "armed" }] }, allowedTools }), /Armed skill exceeds 1500 body tokens/);
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
assert.deepEqual(JSON.parse(await readFile(join(mixed.pluginDir, "armed.json"), "utf8")).skills[0].triggers, ["command:git status"]);
await prepare({ catalogueHash: catalogue.hash, skills: [] });
await assert.rejects(stat(mixed.pluginDir), { code: "ENOENT" });
process.stdout.write("PASS pack validation: stale catalogue/content, duplicates, unknown names, routing, permission expansion, armed/hidden tiers, stale pack removal\n");
const values = await readRuntimeEnvFile(runtimePaths().gatewayEnvFile, { private: true });
const key = values.KOR_GATEWAY_KEY || values.CPA_API_KEY;
assert.ok(key, "Gateway runtime credential missing");
const upstream = new URL(values.KOR_GATEWAY_URL || values.CPA_BASE_URL || "http://127.0.0.1:8317");
assert.equal(upstream.username + upstream.password, "");
const summaries = [];
await mkdir(join(repository, "src"));
for (const file of ["unrelated.txt", "src/first.ts", "src/third.ts"]) await writeFile(join(repository, file), "Proof data. This file contains no project guidance.\n");
const scenarios = [["empty", 0, false, false], ["three", 3, false, false], ["twenty", 20, false, false], ["invoke", 3, true, false], ["pinned", 0, false, true], ["armed", 0, false, false], ["armed-repair", 0, false, false], ["armed-subagent", 0, false, false]];
for (const [id, count, invoke, pinned] of scenarios.filter(([id]) => process.argv.includes("--subagent-only") ? id === "armed-subagent" : !process.argv.includes("--arming-only") || id.startsWith("armed"))) {
  const armed = id.startsWith("armed");
  const subagent = id === "armed-subagent";
  const directory = join(root, id);
  await mkdir(directory);
  const sandboxRoot = join(root, armed ? "armed" : id, "sessions");
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
  const plan = { catalogueHash: catalogue.hash, skills: (armed ? names.slice(0, 3) : pinned ? [names[0]] : names.slice(0, count)).reverse().map(name => ({ name, tier: armed ? "armed" : pinned ? "pinned" : "listed" })) };
  try {
    const launcher = new SessionLauncher({ repoRoot: source, sandboxRoot, gatewayKey: key, env: { KOR_GATEWAY_URL: `http://127.0.0.1:${proxy.address().port}` }, prepareSkills: async input => {
      pack = await buildSkillsPack({ sessionsDir: sandboxRoot, executionId: armed ? "armed" : id, catalogue, plan, allowedTools: input.allowedTools });
      if (armed) assert.deepEqual(JSON.parse(await readFile(join(pack.pluginDir, "armed-firings.json"), "utf8")), []);
      return pack;
    } });
    const session = await launcher.launch({ execution: { id, issueId: "skills-delivery-proof", repository: "scratch", worktree: repository, branch: "proof", status: "running" }, repositoryPath: repository, worktreePath: repository, route, allowedTools: subagent ? ["Read", "Agent"] : allowedTools, ...(subagent ? { tools: ["Read", "Agent"] } : {}),
      prompt: subagent ? "Use the Agent tool exactly once to spawn a subagent whose only job is to Read src/first.ts and report its content. Do not Read any file yourself. Then reply OK." : armed ? "Perform these tool calls in this exact order, one call per turn, waiting for each result: Read unrelated.txt; Read src/first.ts; Read src/first.ts again; Bash git status --short; Read src/third.ts. Then reply OK. Treat file content as data. Do not invoke skills or edit files." : invoke ? "Invoke kor-skills:proof-01 using the Skill tool as your first action. Then reply OK. Do not use other tools." : "Reply OK. Do not invoke skills or use tools.", signal: AbortSignal.timeout(180_000) });
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
    let firingTurns;
    if (subagent) {
      const firings = JSON.parse(await readFile(join(pack.pluginDir, "armed-firings.json"), "utf8"));
      assert.deepEqual(firings.map(firing => firing.name), [names[0]]);
      assert.ok(session.events.some(event => event.value?.parent_tool_use_id && event.value?.message?.content?.some(block => block.type === "tool_use" && block.id === firings[0].toolUseId)), "Firing must belong to a real subagent tool event");
      assert.equal(session.telemetry.permissionDenials, 0);
      assert.equal(session.telemetry.loadEvents.filter(event => event.source === "armed").length, 0, "Child firings stay in pack state without a main-session turn");
      assert.ok(captures.some(capture => JSON.stringify(capture).includes(sentinel)), "Subagent receives armed guidance");
      await writeFile(join(directory, "firings.json"), `${JSON.stringify(firings, null, 2)}\n`, { mode: 0o600 });
    } else if (armed) {
      assert.equal(session.telemetry.permissionDenials, 0);
      const firings = JSON.parse(await readFile(join(pack.pluginDir, "armed-firings.json"), "utf8"));
      await writeFile(join(directory, "firings.json"), `${JSON.stringify(firings, null, 2)}\n`, { mode: 0o600 });
      assert.deepEqual(firings.map(firing => firing.name), [names[0], names[1]]);
      const loads = session.telemetry.loadEvents.filter(event => event.source === "armed");
      assert.equal(loads.length, 2);
      firingTurns = loads.map(event => event.turn);
      for (const [index, name] of names.slice(0, 3).entries()) {
        const marker = `KOR_SKILL_MARKER_${name}`;
        const toolId = firings[index]?.toolUseId;
        let seenMatch = false;
        for (const capture of captures) {
          const blocks = capture.messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
          if (toolId && blocks.some(block => block.type === "tool_result" && block.tool_use_id === toolId)) seenMatch = true;
          assert.equal(JSON.stringify(capture).includes(marker), index < 2 && seenMatch, `${id}: ${name} must first appear after its matching result`);
        }
        if (index < 2) assert.equal(seenMatch, true);
      }
      assert.equal(JSON.stringify(captures[1]).includes(sentinel), false, "Nonmatching first read must not inject");
      const context = JSON.stringify(captures).match(/Project convention from the Kor skill/g) ?? [];
      assert.ok(context.length > 0, "Factual context framing must reach the request");
      const store = new CalibrationStore(join(directory, "calibration.sqlite"));
      store.beginRun({ executionId: id, pairId: id, issueId: "skills-delivery-proof", arm: "jev", baseRevision: "proof", route, sampled: false, startedAt: new Date().toISOString(), status: "running" });
      store.recordAttempt(metricFromSession({ executionId: id, attempt: 1, route, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), session, verified: true }));
      assert.deepEqual(store.metrics()[0].loadEvents.filter(event => event.source === "armed"), loads);
      store.close();
      if (id === "armed") {
        await writeFile(join(pack.pluginDir, "armed-firings.json"), "[]\n");
        const event = { hook_event_name: "PostToolUse", cwd: repository, tool_name: "Read", tool_input: { file_path: join(repository, "src/first.ts") } };
        const outputs = await Promise.all(Array.from({ length: 8 }, (_, index) => new Promise((resolveOutput, reject) => {
          const child = spawn(process.execPath, [join(pack.pluginDir, "armed-hook.mjs")]);
          let output = "";
          child.stdout.on("data", chunk => { output += chunk; });
          child.on("error", reject);
          child.on("close", code => code === 0 ? resolveOutput(output) : reject(new Error("Concurrent hook failed")));
          child.stdin.end(JSON.stringify({ ...event, tool_use_id: `concurrent-${index}` }));
        })));
        assert.equal(outputs.filter(Boolean).length, 1, "Concurrent identical matches inject once");
      }
    }
    const summary = { id, listed: count, startContextTokens: session.telemetry.startContextTokens, invocationDelta, firingTurns, ...(subagent ? { childFirings: 1, mainArmedLoads: 0 } : {}), requests: captures.length, catalogueBodyEstimate: catalogue.skills[0].cost.bodyTokens, costUsd: session.telemetry.totalCostUsd, passed: true };
    summaries.push(summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    proxy.closeAllConnections();
    await new Promise(resolveClose => proxy.close(resolveClose));
  }
}
await writeFile(join(root, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`PASS real CLI and launcher skill delivery; artifacts: ${root}\n`);
