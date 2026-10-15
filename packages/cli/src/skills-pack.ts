import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionSkillPack } from "@kor-code/controller";
import { readSkillBundle, type CatalogueSkill, type SkillsCatalogue } from "./skills-catalogue.js";
import { lintSkills } from "./skills-lint.js";

export interface SkillDeliveryPlan {
  catalogueHash: string;
  skills: { name: string; tier: "pinned" | "listed" | "armed" | "hidden" }[];
}

const PLUGIN_NAME = "kor-skills";
const PLUGIN_MANIFEST = { name: PLUGIN_NAME, version: "1.0.0", description: "Guidance selected for this Kor execution." };
const TOOL_PERMISSION = /[A-Za-z][A-Za-z0-9_]*(?:\([^()\r\n]*\))?/g;
const MAX_ARMED_BODY_TOKENS = 1_500;
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export async function buildSkillsPack(input: {
  sessionsDir: string;
  executionId: string;
  catalogue: SkillsCatalogue;
  plan: SkillDeliveryPlan;
  allowedTools: readonly string[];
}): Promise<SessionSkillPack> {
  const { catalogue, plan } = input;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(input.executionId)) throw new Error("Invalid execution identity for skill pack");
  if (!catalogue.ok || plan.catalogueHash !== catalogue.hash) throw new Error("Skill plan requires the current valid catalogue");
  const names = new Set<string>();
  const selected: { skill: CatalogueSkill; tier: "pinned" | "listed" | "armed" }[] = [];
  for (const entry of plan.skills) {
    if (names.has(entry.name)) throw new Error(`Duplicate skill in delivery plan: ${entry.name}`);
    names.add(entry.name);
    const skill = catalogue.skills.find(skill => skill.name === entry.name);
    if (!skill) throw new Error(`Unknown skill in delivery plan: ${entry.name}`);
    if (entry.tier !== "hidden") selected.push({ skill, tier: entry.tier });
  }
  selected.sort((a, b) => compare(a.skill.name, b.skill.name));
  const tools = new Set(input.allowedTools.map(tool => tool.split("(")[0]));
  const bundles = [];
  for (const { skill, tier } of selected) {
    if (skill.requires.some(tool => !tools.has(tool))) throw new Error(`Skill requires unavailable tools: ${skill.name}`);
    const origin = skill.origins[0];
    if (!origin) throw new Error(`Skill has no catalogue source: ${skill.name}`);
    const path = await realpath(origin.path);
    const bundle = await readSkillBundle(path, origin.tier);
    if (bundle.hash !== skill.hash || bundle.header.name !== skill.name) throw new Error(`Skill changed since indexing: ${skill.name}`);
    const grants = bundle.header["allowed-tools"] ?? "";
    if (grants.replace(TOOL_PERMISSION, "").replace(/[,\s]/g, "") || (grants.match(TOOL_PERMISSION) ?? []).some(tool => !input.allowedTools.includes(tool))) throw new Error(`Skill cannot expand repository permissions: ${skill.name}`);
    const directory = dirname(path);
    const lint = await lintSkills(dirname(directory), { names: [basename(directory)], visibility: "local-only" });
    if (!lint.ok) throw new Error(`Skill cannot be delivered: ${skill.name} (${[...new Set(lint.diagnostics.filter(item => item.severity === "error").map(item => item.rule))].sort().join(", ")})`);
    if (tier === "listed" && bundle.header["disable-model-invocation"]) throw new Error(`Manual-only skill cannot be listed: ${skill.name}`);
    if (tier === "armed" && Math.max(skill.cost.bodyTokens, Math.ceil(bundle.body.trim().length / 3.7)) > MAX_ARMED_BODY_TOKENS) throw new Error(`Armed skill exceeds ${MAX_ARMED_BODY_TOKENS} body tokens: ${skill.name}`);
    const triggers = bundle.header.metadata?.["kor.triggers"]?.split(/[,;]/).map(trigger => trigger.trim()).filter(Boolean) ?? [];
    bundles.push({ skill, tier, directory, triggers, body: bundle.body.trim() });
  }

  const session = resolve(input.sessionsDir, input.executionId);
  await mkdir(session, { recursive: true, mode: 0o700 });
  await chmod(session, 0o700);
  const pluginDir = join(session, "skills-pack");
  const listed = bundles.filter(bundle => bundle.tier === "listed");
  const armed = bundles.filter(bundle => bundle.tier === "armed");
  const pinnedGuidance = bundles.filter(bundle => bundle.tier === "pinned")
    .map(bundle => `Selected guidance: ${bundle.skill.name}\n\n${bundle.body}\n\n`).join("");
  if (!listed.length && !armed.length) {
    await rm(pluginDir, { recursive: true, force: true });
    return { listedSkills: [], pinnedGuidance };
  }
  const temporary = join(session, `.skills-pack-${randomUUID()}`);
  try {
    await mkdir(join(temporary, ".claude-plugin"), { recursive: true, mode: 0o700 });
    await writeFile(join(temporary, ".claude-plugin", "plugin.json"), `${JSON.stringify(PLUGIN_MANIFEST, null, 2)}\n`, { mode: 0o600 });
    await mkdir(join(temporary, "skills"), { mode: 0o700 });
    for (const bundle of listed) await symlink(bundle.directory, join(temporary, "skills", bundle.skill.name), "dir");
    if (armed.length) {
      await writeFile(join(temporary, "armed.json"), `${JSON.stringify({ schemaVersion: 1, skills: armed.map(bundle => ({ name: bundle.skill.name, path: bundle.directory, hash: bundle.skill.hash, triggers: bundle.triggers, body: bundle.body, bodyHash: createHash("sha256").update(bundle.body).digest("hex") })) }, null, 2)}\n`, { mode: 0o600 });
      await writeFile(join(temporary, "armed-firings.json"), "[]\n", { mode: 0o600 });
      await copyFile(new URL("../../../scripts/skills-armed-hook.mjs", import.meta.url), join(temporary, "armed-hook.mjs"));
      await chmod(join(temporary, "armed-hook.mjs"), 0o600);
      await mkdir(join(temporary, "hooks"), { mode: 0o700 });
      const command = `${shellQuote(process.execPath)} ${shellQuote(join(pluginDir, "armed-hook.mjs"))}`;
      await writeFile(join(temporary, "hooks", "hooks.json"), `${JSON.stringify({ hooks: { PostToolUse: [{ matcher: ".*", hooks: [{ type: "command", command, timeout: 5 }] }] } }, null, 2)}\n`, { mode: 0o600 });
    }
    await rm(pluginDir, { recursive: true, force: true });
    await rename(temporary, pluginDir);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { pluginDir, listedSkills: listed.map(bundle => bundle.skill.name), pinnedGuidance };
}
