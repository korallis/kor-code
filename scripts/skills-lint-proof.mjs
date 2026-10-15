#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const cli = join(repo, "packages/cli/dist/cli.js");
const scratch = await mkdtemp(join(tmpdir(), "kor-skills-lint-"));
const description = "Reviews changes for acceptance gaps. Use when reviewing a completed implementation.";
const source = (header = "", body = "# Review\n\nRead the diff and verify acceptance.\n", desc = description, name = "proof-skill") =>
  `---\nname: ${name}\ndescription: ${desc}\nlicense: MIT\n${header}---\n${body}`;

function run(args, status = 0) {
  const result = spawnSync(process.execPath, [cli, "skills", ...args], { cwd: scratch, encoding: "utf8" });
  if (result.error || result.status !== status) throw new Error(`Unexpected CLI result (${result.status}): ${result.error ?? result.stdout + result.stderr}`);
  return JSON.parse(result.stdout);
}

try {
  const seeds = run(["lint", "--json"]);
  if (!seeds.ok || seeds.skills.length !== 2 || seeds.diagnostics.length) throw new Error("Seed lint must pass without warnings.");
  for (const skill of seeds.skills) console.log(`PASS seed ${skill.name}: listing=${skill.listingTokens}, body=${skill.bodyTokens} estimated tokens`);
  const cases = [
    ["schema", source("", undefined, description, "Uppercase")],
    ["schema", source("", undefined, "x".repeat(1_100))],
    ["directory-name", source("", undefined, description, "other-name")],
    ["frontmatter", "name: proof-skill\n"],
    ["frontmatter", source("name: duplicate\n")],
    ["schema", source("unexpected: true\n")],
    ["description-trigger", source("", undefined, "Reviews changes for acceptance gaps.")],
    ["description-third-person", source("", undefined, "Review changes. Use when checking acceptance.")],
    ["no-routing-field", source("model: claude-example-1\n")],
    ["no-routing-field", source("effort: high\n")],
    ["no-routing-field", source("agent: specialist\n")],
    ["no-routing-field", source("provider: example\n")],
    ["no-routing-field", source("harness: example\n")],
    ["no-routing-field", source("metadata:\n  nested.model: example\n")],
    ["no-routing", source("", "Use gpt-example-1 for this task.\n")],
    ["no-routing", source("", "```sh\nrun --agents '{\"worker\": {\"model\": \"gpt-example-1\"}}'\n```\n")],
    ["no-routing", source("", "Choose the Codex harness.\n")],
    ["body-empty", source("", "")],
    ["body-lines", source("", "Read this line.\n".repeat(501))],
    ["forward-slash-paths", source("", "Read C:\\docs\\guide.md.\n")],
    ["reference-missing", source("", "Read [guide](references/missing.md).\n")],
    ["reference-path", source("", "Read [guide](../../outside.md).\n")],
    ["metadata", source('metadata:\n  kor.budget: "zero"\n')],
    ["metadata", source('metadata:\n  kor.kind: "unknown"\n')],
    ["metadata", source('metadata:\n  kor.stages: "unknown"\n')],
    ["metadata", source('metadata:\n  kor.visibility: "local-only"\n')],
    ["nested-reference", source("", "Read [guide](references/guide.md).\n"), { "references/guide.md": "Read [more](more.md).\n", "references/more.md": "Details.\n" }],
    ["reference-toc", source("", "Read [guide](references/guide.md).\n"), { "references/guide.md": "Read a step.\n".repeat(101) }],
    ["no-routing", source(), { "references/guide.md": "Use gemini-example-1.\n" }],
    ["no-routing", source(), { "scripts/run.sh": "tool --model gpt-example-1\n" }],
    ["upstream-quote", source("", "```upstream-quote https://example.org/source\nQuoted gpt-example-1\n")],
    ["trigger-late", source("", undefined, `Reviews ${"specific changes ".repeat(9)}. Use when reviewing acceptance.`), {}, 0],
    ["body-budget", source('metadata:\n  kor.budget: "1"\n'), {}, 0],
    ["vital-rule-late", source("", "Read this line.\n".repeat(150) + "MUST verify the diff.\n"), {}, 0],
    ["time-sensitive", source("", "As of 2026-01-01, review changes.\n"), {}, 0],
    ["terminology", source("", "JEV selects the skillset.\n"), {}, 0],
    ["overlap-anti", source(), { "../other-skill/SKILL.md": source("", undefined, description, "other-skill") }],
  ];
  for (const [index, [rule, skill, files = {}, status = 1]] of cases.entries()) {
    const root = join(scratch, String(index));
    const directory = join(root, "proof-skill");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "SKILL.md"), skill);
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(directory, path, ".."), { recursive: true });
      await writeFile(join(directory, path), text);
    }
    const report = run(["lint", root, "--json"], status);
    if (!report.diagnostics.some(item => item.rule === rule)) throw new Error(`Missing diagnostic ${rule}`);
    console.log(`PASS planted ${index + 1}: ${rule} (exit ${status})`);
  }
  const quotes = join(scratch, "quotation", "proof-skill");
  await mkdir(quotes, { recursive: true });
  await writeFile(join(quotes, "SKILL.md"), source("", "```upstream-quote https://example.org/source\nQuoted gpt-example-1 and effort.\n```\n\nRead the diff.\n"));
  if (!run(["lint", join(quotes, ".."), "--json"]).ok) throw new Error("Attributed upstream quotation should pass.");
  await symlink(join(quotes, "SKILL.md"), join(quotes, "linked.md"));
  if (!run(["lint", join(quotes, ".."), "--json"], 1).diagnostics.some(item => item.rule === "symlink")) throw new Error("Symlinks must fail.");
  const empty = join(scratch, "empty");
  await mkdir(empty);
  if (!run(["lint", empty, "--json"], 1).diagnostics.some(item => item.rule === "empty-tier")) throw new Error("Empty tiers must fail.");
  await mkdir(join(empty, "missing-skill"));
  if (!run(["lint", empty, "--json"], 1).diagnostics.some(item => item.rule === "skill-file")) throw new Error("Missing SKILL.md must fail.");
  for (const args of [["lint", "--unknown"], ["unknown"], ["lint", "one", "two"]]) {
    if (run([...args, "--json"], 2).error.code !== "invalid_arguments") throw new Error("Expected usage error.");
  }
  console.log(`PASS ${cases.length} planted cases, attributed quotation, symlink, empty tier, missing SKILL.md, 3 usage errors; default tier resolved outside the checkout`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
