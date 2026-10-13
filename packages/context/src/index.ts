import { readFile, realpath, readdir, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import type { ContextManifest, ContextSource } from "@kor-code/core";
import { redact, type JevDecisionCore } from "@kor-code/jev";

const RULE_NAMES = new Set(["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "INSTRUCTIONS.md"]);
const MAX_SOURCE_BYTES = 256 * 1024;

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

async function walk(root: string, directory: string, found: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && (entry.name === ".git" || entry.name === "node_modules")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(root, path, found);
    else if (entry.isFile() && RULE_NAMES.has(entry.name) && inside(root, path)) found.push(path);
  }
}

export interface ContextBuildOptions {
  executionId: string;
  repository: string;
  worktree: string;
  issue?: string;
  documents?: readonly { id: string; title: string; content: string }[];
  evidence?: readonly { id: string; summary: string }[];
  maxCharacters?: number;
  rank?: (source: ContextSource) => number;
  jev?: Pick<JevDecisionCore, "rankContext">;
}

export async function discoverRepositoryRules(worktree: string): Promise<string[]> {
  const root = await realpath(worktree);
  const found: string[] = [];
  await walk(root, root, found);
  return found.sort();
}

export function compactContext(sources: readonly ContextSource[], maxCharacters = 80_000): ContextSource[] {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new Error("Context character limit must be positive");
  let remaining = maxCharacters;
  return sources.flatMap(source => {
    if (remaining <= 0) return [];
    const content = source.content.slice(0, remaining);
    remaining -= content.length;
    return [{ ...source, content }];
  });
}

export async function buildContextManifest(options: ContextBuildOptions): Promise<ContextManifest> {
  const root = await realpath(options.worktree);
  const rulePaths = await discoverRepositoryRules(root);
  const sources: ContextSource[] = [];
  for (const path of rulePaths) {
    const info = await stat(path);
    if (info.size > MAX_SOURCE_BYTES) throw new Error(`Repository rule is too large: ${basename(path)}`);
    const content = String(redact(await readFile(path, "utf8")));
    sources.push({ id: `rule:${relative(root, path)}`, path: relative(root, path), purpose: "rule", relevance: 1, content });
  }
  if (options.issue) sources.push({ id: "linear:issue", path: "linear", purpose: "issue", relevance: 1, content: String(redact(options.issue)) });
  for (const document of options.documents ?? []) sources.push({ id: `linear:document:${document.id}`, path: document.title, purpose: "document", relevance: 0.5, content: String(redact(document.content)) });
  for (const item of options.evidence ?? []) sources.push({ id: `evidence:${item.id}`, path: "evidence", purpose: "evidence", relevance: 0.5, content: String(redact(item.summary)) });
  let ranked = sources.map(source => ({ ...source, relevance: options.rank?.(source) ?? source.relevance }));
  if (!options.rank && options.jev && ranked.length > 0) {
    const decision = await options.jev.rankContext({ decisionId: `context-${options.executionId}`, executionId: options.executionId, kind: "context", question: "Which repository context source is most relevant to this execution?", state: { issue: options.issue ?? "", sources: ranked.map(source => ({ id: source.id, purpose: source.purpose, content: source.content })) }, inputs: [{ name: "execution", value: options.executionId, source: "controller" }], candidates: ranked.map(source => source.id), policyChecks: [{ name: "worktree-only", result: "pass" }] });
    if (decision.applied) ranked = ranked.map(source => ({ ...source, relevance: source.id === decision.choice ? 1 : source.relevance * 0.9 }));
  }
  ranked.sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id));
  const compacted = compactContext(ranked, options.maxCharacters);
  return { executionId: options.executionId, repository: options.repository, worktree: root, sources: compacted, compacted: compacted.length !== ranked.length || compacted.some((item, i) => item.content !== ranked[i]?.content), redacted: true };
}
