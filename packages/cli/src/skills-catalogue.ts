import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { gatewayUrl, readRuntimeEnvFile, type KorConfig, type KorPaths } from "@kor-code/config";
import { lintSkills, privateSkillMetadataSchema, skillFrontmatterSchema } from "./skills-lint.js";

const CHARS_PER_TOKEN = 3.7;
const MAX_BODY_LINES = 500;
const SUMMARY_CHARS = 300;
const COUNT_TIMEOUT_MS = 2_000;
const DEFAULT_LISTING_BUDGET = 8_000;
const DEFAULT_BODY_BUDGET = 2_000;
const STAGES = new Set(["plan", "execute", "repair", "review", "ship", "project-setup"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);
const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);
const headerSchema = skillFrontmatterSchema.pick({ name: true, description: true, metadata: true, "disable-model-invocation": true, "allowed-tools": true })
  .extend({
    license: z.string().optional(),
    metadata: privateSkillMetadataSchema.optional(),
  }).loose();
const countSchema = z.object({ input_tokens: z.number().int().nonnegative() });

export interface SkillOrigin {
  tier: "public" | "private" | "pack" | "from";
  path: string;
}
export interface CatalogueSkill {
  name: string;
  tier: SkillOrigin["tier"];
  kind: string;
  stages: string[];
  stackTags?: string[];
  summary: string;
  triggers: string[];
  anti: string[];
  requires: string[];
  visibility: "public" | "local-only";
  jevVisible: "full" | "names-only";
  cost: { listingTokens: number; bodyTokens: number; referencesMaxTokens: number; method: "count_tokens" | "estimate" };
  hash: string;
  source: { license: string | null; url?: string; commit?: string };
  origins: SkillOrigin[];
  stats: { offered: number; loaded: number; used: number; passRate: null; lift: null };
}
export interface CatalogueDiagnostic {
  severity: "error" | "warning";
  rule: string;
  path: string;
  message: string;
}
export interface SkillsCatalogue {
  schemaVersion: 1;
  hash: string;
  ok: boolean;
  budgets: { listing: number; body: number };
  totals: { discovered: number; skills: number; duplicates: number; listingTokens: number; bodyTokens: number };
  skills: CatalogueSkill[];
  duplicates: { hash: string; names: string[]; origins: SkillOrigin[] }[];
  diagnostics: CatalogueDiagnostic[];
}
interface Candidate {
  header: z.infer<typeof headerSchema>;
  body: string;
  references: string[];
  hash: string;
  origin: SkillOrigin;
}

function hash(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function split(value: string | undefined): string[] { return value?.split(/[,;]/).map(item => item.trim()).filter(Boolean) ?? []; }
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

export async function skillFiles(root: string): Promise<string[]> {
  const seen = new Set<string>();
  async function visit(path: string): Promise<string[]> {
    const canonical = await realpath(path);
    if (seen.has(canonical)) return [];
    seen.add(canonical);
    if (!(await stat(canonical)).isDirectory()) return basename(canonical) === "SKILL.md" ? [canonical] : [];
    const entries = await readdir(canonical, { withFileTypes: true });
    if (entries.some(entry => entry.name === "SKILL.md")) return [join(canonical, "SKILL.md")];
    const result: string[] = [];
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      if (!SKIP_DIRECTORIES.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) result.push(...await visit(join(canonical, entry.name)));
    }
    return result;
  }
  return visit(root);
}

export async function readSkillBundle(path: string, tier: SkillOrigin["tier"]): Promise<Candidate> {
  const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!match) throw new Error("Missing YAML frontmatter");
  const header = headerSchema.safeParse(parse(match[1] ?? "", { uniqueKeys: true, maxAliasCount: 0 }));
  if (!header.success) throw new Error("Invalid name, description or metadata in frontmatter");
  const files: { path: string; hash: string }[] = [];
  const references: string[] = [];
  async function bundle(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const file = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Bundle contains a symlink; copy its target into the bundle first");
      if (entry.isDirectory()) await bundle(file);
      else if (entry.isFile()) {
        const content = await readFile(file);
        const local = relative(dirname(path), file).split("\\").join("/");
        files.push({ path: local, hash: hash(content) });
        if (local.startsWith("references/") && TEXT_EXTENSIONS.has(extname(file))) references.push(content.toString("utf8"));
      }
    }
  }
  await bundle(dirname(path));
  files.sort((a, b) => compare(a.path, b.path));
  const metadata = header.data.metadata ?? {};
  if (metadata["kor.kind"] !== undefined && !["skill", "standard", "playbook"].includes(metadata["kor.kind"]) ||
    metadata["kor.visibility"] !== undefined && !["public", "local-only"].includes(metadata["kor.visibility"]) ||
    split(metadata["kor.stages"]).some(stage => !STAGES.has(stage)) ||
    metadata["kor.budget"] !== undefined && (!/^[1-9]\d*$/.test(metadata["kor.budget"]) || !Number.isSafeInteger(Number(metadata["kor.budget"])))) {
    throw new Error("Invalid Kor metadata value");
  }
  if (!source.slice(match[0].length).trim()) throw new Error("Skill body is empty");
  return { header: header.data, body: source.slice(match[0].length), references, hash: hash(JSON.stringify(files)), origin: { tier, path } };
}

async function tokenCounter(config: KorConfig, paths: KorPaths, estimate: boolean) {
  let gateway: { url: string; key: string } | undefined;
  if (!estimate) {
    const values = await readRuntimeEnvFile(paths.gatewayEnvFile, { private: true });
    const key = process.env.KOR_GATEWAY_KEY || values.KOR_GATEWAY_KEY || values.CPA_API_KEY;
    if (key) gateway = { url: gatewayUrl(process.env.KOR_GATEWAY_URL || values.KOR_GATEWAY_URL || values.CPA_BASE_URL || "http://127.0.0.1:8317"), key };
  }
  return async (texts: string[], privateText: boolean): Promise<{ tokens: number[]; method: CatalogueSkill["cost"]["method"] }> => {
    const estimates = () => ({ tokens: texts.map(text => Math.ceil(text.length / CHARS_PER_TOKEN)), method: "estimate" as const });
    if (!gateway || privateText) return estimates();
    const active = gateway;
    try {
      const tokens: number[] = [];
      for (const text of texts) {
        if (!text) { tokens.push(0); continue; }
        const response = await fetch(`${active.url}/v1/messages/count_tokens`, {
          method: "POST", signal: AbortSignal.timeout(COUNT_TIMEOUT_MS),
          headers: { "content-type": "application/json", "x-api-key": active.key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: config.defaultRoute.model, messages: [{ role: "user", content: text }] }),
        });
        if (!response.ok) throw new Error("Token counting unavailable");
        tokens.push(countSchema.parse(await response.json()).input_tokens);
      }
      return { tokens, method: "count_tokens" };
    } catch {
      gateway = undefined;
      return estimates();
    }
  };
}

export async function buildSkillsCatalogue(options: { config: KorConfig; paths: KorPaths; from?: string[]; estimate?: boolean }): Promise<SkillsCatalogue> {
  const { config, paths } = options;
  const budgets = { listing: config.skills?.listingBudget ?? DEFAULT_LISTING_BUDGET, body: config.skills?.bodyBudget ?? DEFAULT_BODY_BUDGET };
  const diagnostics: CatalogueDiagnostic[] = [];
  const candidates: Candidate[] = [];
  const publicRoot = new URL("../../../skills", import.meta.url);
  const sources: { path: string; tier: SkillOrigin["tier"]; optional?: boolean }[] = options.from?.length
    ? options.from.map(path => ({ path: resolve(path), tier: "from" }))
    : [
      { path: fileURLToPath(publicRoot), tier: "public" },
      { path: config.skills?.privatePath ?? join(paths.configDir, "skills"), tier: "private", optional: config.skills?.privatePath === undefined },
      ...(config.skills?.packs ?? []).map(path => ({ path, tier: "pack" as const })),
    ];
  for (const source of sources.sort((a, b) => compare(a.tier, b.tier) || compare(a.path, b.path))) {
    let files: string[];
    try { files = await skillFiles(source.path); }
    catch (error) {
      if (source.optional && missing(error)) continue;
      diagnostics.push({ severity: "error", rule: "source", path: source.path, message: "Cannot read skills source" });
      continue;
    }
    if (source.tier === "public" || source.tier === "private" && files.length > 0) {
      const lint = await lintSkills(source.path, { private: source.tier === "private" });
      diagnostics.push(...lint.diagnostics.map(item => ({ severity: item.severity, rule: item.rule, path: join(source.path, item.file), message: item.message })));
    }
    for (const path of files) {
      try {
        if (!candidates.some(candidate => candidate.origin.path === path && candidate.origin.tier === source.tier)) candidates.push(await readSkillBundle(path, source.tier));
      }
      catch (error) { diagnostics.push({ severity: "error", rule: "skill-format", path, message: error instanceof Error && error.name !== "YAMLParseError" ? error.message : "Invalid YAML frontmatter" }); }
    }
  }
  const count = await tokenCounter(config, paths, Boolean(options.estimate || options.from?.length));
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.hash) ?? [];
    if (!group.some(item => item.origin.path === candidate.origin.path && item.origin.tier === candidate.origin.tier)) group.push(candidate);
    groups.set(candidate.hash, group);
  }
  const duplicates: SkillsCatalogue["duplicates"] = [];
  const skills: CatalogueSkill[] = [];
  for (const [contentHash, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
    group.sort((a, b) => compare(a.origin.tier, b.origin.tier) || compare(a.origin.path, b.origin.path));
    const candidate = group.find(item => item.origin.tier === "public") ?? group.find(item => item.origin.tier === "private") ?? group[0];
    if (!candidate) continue;
    const { header, body, references } = candidate;
    const metadata = header.metadata ?? {};
    const origins = group.map(item => item.origin);
    if (group.length > 1) duplicates.push({ hash: contentHash, names: [...new Set(group.map(item => item.header.name))].sort(compare), origins });
    const privateText = group.some(item => item.header.metadata?.["kor.visibility"] === "local-only" || item.origin.tier === "private" && config.skills?.jev !== "full" || item.origin.tier === "from");
    const summary = privateText ? "Private guidance (local-only)." : header.description.slice(0, SUMMARY_CHARS);
    const listing = header["disable-model-invocation"] ? "" : `${header.name}: ${privateText ? summary : header.description}`;
    const cost = await count([listing, body, ...references], privateText);
    const bodyTokens = cost.tokens[1] ?? 0;
    const bodyBudget = /^\d+$/.test(metadata["kor.budget"] ?? "") ? Number(metadata["kor.budget"]) : budgets.body;
    if (bodyTokens > bodyBudget) diagnostics.push({ severity: "warning", rule: "body-budget", path: candidate.origin.path, message: `${header.name}: ${bodyTokens} body tokens exceed ${bodyBudget}` });
    const bodyLines = body.trimEnd().split("\n").length;
    if (bodyLines > MAX_BODY_LINES) diagnostics.push({ severity: "warning", rule: "body-lines", path: candidate.origin.path, message: `${header.name}: ${bodyLines} body lines exceed ${MAX_BODY_LINES}` });
    skills.push({
      name: header.name, tier: candidate.origin.tier, kind: metadata["kor.kind"] ?? "skill", stages: split(metadata["kor.stages"]),
      stackTags: split(metadata["kor.stack"]), summary,
      triggers: privateText ? [] : split(metadata["kor.triggers"]), anti: privateText ? [] : split(metadata["kor.anti"]), requires: split(metadata["kor.requires"]),
      visibility: privateText ? "local-only" : "public",
      jevVisible: privateText ? "names-only" : "full",
      cost: { listingTokens: cost.tokens[0] ?? 0, bodyTokens, referencesMaxTokens: cost.tokens.slice(2).reduce((sum, value) => sum + value, 0), method: cost.method },
      hash: contentHash, source: { license: header.license ?? null, ...(metadata["kor.source"] ? { url: metadata["kor.source"] } : {}), ...(metadata["kor.commit"] ? { commit: metadata["kor.commit"] } : {}) },
      origins, stats: { offered: 0, loaded: 0, used: 0, passRate: null, lift: null },
    });
  }
  const names = new Map<string, CatalogueSkill[]>();
  for (const skill of skills) names.set(skill.name, [...(names.get(skill.name) ?? []), skill]);
  const shadowed = new Set<CatalogueSkill>();
  for (const [name, matches] of names) {
    if (matches.length < 2) continue;
    const override = matches.find(skill => skill.tier === "private" && candidates.find(candidate => candidate.hash === skill.hash && candidate.origin.tier === "private")?.header.metadata?.["kor.overrides"] === "public");
    if (matches.length === 2 && override && matches.some(skill => skill.tier === "public")) {
      for (const skill of matches) if (skill !== override) shadowed.add(skill);
      diagnostics.push({ severity: "warning", rule: "override", path: override.origins[0]?.path ?? "", message: `${name}: private skill explicitly overrides public skill` });
    } else diagnostics.push({ severity: "error", rule: "name-collision", path: matches[0]?.origins[0]?.path ?? "", message: `${name}: different content uses the same name (${matches.map(skill => skill.hash).join(", ")})` });
  }
  const active = skills.filter(skill => !shadowed.has(skill)).sort((a, b) => compare(a.name, b.name) || compare(a.hash, b.hash));
  const listingTokens = active.reduce((sum, skill) => sum + skill.cost.listingTokens, 0);
  if (listingTokens > budgets.listing) diagnostics.push({ severity: "warning", rule: "listing-budget", path: "", message: `${listingTokens} combined listing tokens exceed ${budgets.listing}; select a smaller set before delivery` });
  diagnostics.sort((a, b) => compare(a.path, b.path) || compare(a.rule, b.rule) || compare(a.message, b.message));
  const snapshot = {
    schemaVersion: 1 as const, ok: !diagnostics.some(item => item.severity === "error"), budgets,
    totals: { discovered: candidates.length, skills: active.length, duplicates: duplicates.reduce((sum, group) => sum + group.origins.length - 1, 0), listingTokens, bodyTokens: active.reduce((sum, skill) => sum + skill.cost.bodyTokens, 0) },
    skills: active, duplicates, diagnostics,
  };
  return { ...snapshot, hash: hash(JSON.stringify(snapshot)) };
}

export async function writeSkillsCatalogue(catalogue: SkillsCatalogue, paths: KorPaths): Promise<string> {
  const directory = join(paths.stateDir, "skills");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, "catalogue.json");
  const temporary = join(directory, `.catalogue-${randomUUID()}.json`);
  await writeFile(temporary, `${JSON.stringify(catalogue, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return path;
}

export function formatSkillsCatalogue(catalogue: SkillsCatalogue): string {
  return [
    ...catalogue.skills.map(skill => `${skill.name} [${skill.tier}, ${skill.visibility}, ${skill.jevVisible}]: listing ${skill.cost.listingTokens}, body ${skill.cost.bodyTokens}, references ${skill.cost.referencesMaxTokens} tokens (${skill.cost.method})`),
    ...catalogue.duplicates.map(group => `DUPLICATE ${group.names.join(", ")}: ${group.origins.length} copies, ${group.hash}`),
    ...catalogue.diagnostics.map(item => `${item.severity.toUpperCase()} [${item.rule}] ${item.path}: ${item.message}`),
    `${catalogue.ok ? "PASS" : "FAIL"} catalogue: ${catalogue.totals.skills} skills, ${catalogue.totals.duplicates} duplicates, ${catalogue.totals.listingTokens}/${catalogue.budgets.listing} listing tokens; ${catalogue.hash}`,
  ].join("\n");
}
