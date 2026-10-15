#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { JevClient, JevDecisionCore, JevUnavailableError, MemoryDecisionAuditLog } from "../packages/jev/dist/index.js";
import { buildSkillsPack } from "../packages/cli/dist/skills-pack.js";

const root = resolve(import.meta.dirname, "..");
const output = process.argv[2] && resolve(process.argv[2]);
if (!output) throw new Error("Usage: node scripts/playbooks-proof.mjs OUTPUT_DIRECTORY");
const local = relative(root, output);
if (!isAbsolute(local) && !local.startsWith("..")) throw new Error("Keep proof output outside the checkout");
await mkdir(output, { recursive: true, mode: 0o700 });
const catalogue = JSON.parse(execFileSync(join(root, "bin/kor"), ["skills", "list", "--estimate", "--json"], { encoding: "utf8" }));
assert.equal(catalogue.ok, true);
const tasks = [
  ["Repair the checkout crash when an empty cart is submitted. Reproduce and ship the smallest causal fix.", "fix-bug"],
  ["Implement CSV export with the defined acceptance criteria: download headers and the current filtered rows.", "build-feature"],
  ["Refactor duplicated date formatting into one helper while preserving all outputs and public APIs.", "refactor"],
  ["Investigate how the queue owns execution leases. Return a read-only evidence report, no code changes.", "investigate"],
  ["Update the installation README and CLI reference to match the current help output. Documentation only.", "change-docs"],
  ["Build a throwaway prototype to resolve whether a three-column layout fits the supplied content. Do not ship it.", "prototype"],
  ["Match the implemented checkout screen to the approved design baseline, comparing every viewport and state.", "match-design"],
  ["Before implementation, sketch caller usage, domain types, module ownership and interfaces for the new storage boundary. No logic yet.", "sketch-types"],
  ["Diagnose the intermittent save failure. Reproduce and establish its cause with counterfactual evidence. Stop at the diagnosis report; do not fix.", "diagnose-bug"],
  ["Set up a new project from the product brief, including documentation, screen mockups and delivery tickets.", "setting-up-a-project"],
  ["Reply with exactly ACK. No procedure or engineering work is needed.", "none"],
  ["Implement CSV export. Repair attempt 2: the existing export check now fails with a TypeError on empty rows. Find and fix the regression, then rerun the check.", "fix-bug"],
];
const audit = new MemoryDecisionAuditLog();
const jev = new JevDecisionCore(new JevClient(), audit);
const allowedTools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
const results = [];
for (const [index, [task, expected]] of tasks.entries()) {
  const input = { executionId: index === 11 ? "task-1" : `task-${index}`, task, stage: index === 11 ? "repair" : "execute", catalogue, allowedTools,
    attemptId: index === 11 ? "repair-2" : "initial",
    ...(index === 11 ? { failure: { classes: ["check-failure"], blockers: ["export check: TypeError on empty rows"] } } : {}) };
  const decision = await jev.selectPlaybook(input);
  assert.equal(decision.playbookPlan.source, "jev");
  const pack = await buildSkillsPack({ sessionsDir: join(output, "sessions"), executionId: `proof-${index}`, catalogue,
    plan: { catalogueHash: catalogue.hash, skills: decision.playbookPlan.selected ? [{ name: decision.playbookPlan.selected, tier: "pinned" }] : [] }, allowedTools });
  assert.equal(pack.listedSkills.length, 0);
  assert.equal(pack.pluginDir, undefined);
  assert.equal((pack.pinnedGuidance.match(/Selected guidance:/g) ?? []).length, expected === "none" ? 0 : 1);
  assert.ok(decision.playbookPlan.tokens <= 1_500);
  assert.deepEqual(await jev.selectPlaybook(input), decision);
  results.push({ expected, actual: decision.choice, decisionId: decision.decisionId, ...decision.playbookPlan });
  await writeFile(join(output, "audit.json"), audit.serialize(), { mode: 0o600 });
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(`${index + 1}/12 expected=${expected} actual=${decision.choice} tier=${decision.playbookPlan.tier} tokens=${decision.playbookPlan.tokens}`);
}
const imported = new MemoryDecisionAuditLog();
imported.importSerialized(audit.serialize());
for (const item of results) assert.deepEqual(imported.replay(item.decisionId), jev.replay(item.decisionId));
assert.notEqual(results[1].decisionId, results[11].decisionId);
const base = { executionId: "policy", task: "Fix a regression", stage: "repair", catalogue, allowedTools };
const unavailable = new JevDecisionCore({ evaluate: async () => { throw new JevUnavailableError("Proof outage"); } });
assert.equal((await unavailable.selectPlaybook(base)).playbookPlan.source, "fallback");
assert.equal((await unavailable.selectPlaybook({ ...base, override: "fix-bug" })).playbookPlan.source, "override");
assert.equal((await unavailable.selectPlaybook({ ...base, override: "none" })).playbookPlan.selected, null);
await assert.rejects(unavailable.selectPlaybook({ ...base, override: "missing" }), /unavailable/);
await assert.rejects(unavailable.selectPlaybook({ ...base, override: "fix-bug", never: ["fix-bug"] }), /unavailable/);
await assert.rejects(unavailable.selectPlaybook({ ...base, override: "setting-up-a-project", stage: "execute", allowedTools: [] }), /unavailable/);
await assert.rejects(unavailable.selectPlaybook({ ...base, override: "setting-up-a-project" }), /unavailable/);
await assert.rejects(unavailable.selectPlaybook({ ...base, override: "fix-bug", catalogue: { ...catalogue,
  skills: catalogue.skills.map(skill => skill.name === "fix-bug" ? { ...skill, cost: { ...skill.cost, bodyTokens: 1_501 } } : skill) } }), /unavailable/);
const plan = skills => ({ sessionsDir: join(output, "policies"), executionId: "policy", catalogue, allowedTools, plan: { catalogueHash: catalogue.hash, skills } });
await assert.rejects(buildSkillsPack(plan([{ name: "fix-bug", tier: "pinned" }, { name: "build-feature", tier: "pinned" }])), /at most one/);
await assert.rejects(buildSkillsPack(plan([{ name: "fix-bug", tier: "listed" }])), /at most one/);
const correct = results.filter(item => item.expected === item.actual).length;
console.log(`playbooks: live=${correct}/12; maxTokens=${Math.max(...results.map(item => item.tokens))}/1500; replay=identical; repair=fresh; policy=pass`);
assert.equal(correct, 12);
