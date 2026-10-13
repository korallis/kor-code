import { readFile, realpath, readdir, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import type { ContextManifest, ContextSource, ContextSourceReference } from "@kor-code/core";
import { redact, type JevDecisionCore } from "@kor-code/jev";

const RULE_NAMES = new Set(["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "CONTRIBUTING.md", "INSTRUCTIONS.md"]);
const MAX_SOURCE_BYTES = 256 * 1024;

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

function isRuleFile(root: string, path: string): boolean {
  const rel = relative(root, path);
  const segments = rel.split(sep);
  return RULE_NAMES.has(basename(path)) || (segments.length >= 3 && segments[0] === ".claude" && segments[1] === "rules" && basename(path).endsWith(".md"));
}

async function walk(root: string, directory: string, found: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && (entry.name === ".git" || entry.name === "node_modules")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(root, path, found);
    else if (entry.isFile() && inside(root, path) && isRuleFile(root, path)) found.push(path);
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

function boundedDecisionSources(sources: readonly ContextSource[], maxCharacters: number): ContextSource[] {
  let remaining = maxCharacters;
  return sources.map((source, index) => {
    const slots = sources.length - index;
    const length = Math.floor(remaining / slots);
    const content = source.content.slice(0, length);
    remaining -= content.length;
    return { ...source, content };
  });
}

function reference(source: ContextSource): ContextSourceReference {
  return { id: source.id, path: source.path, purpose: source.purpose };
}

export async function buildContextManifest(options: ContextBuildOptions): Promise<ContextManifest> {
  const maxCharacters = options.maxCharacters ?? 80_000;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new Error("Context character limit must be positive");
  const root = await realpath(options.worktree);
  const rulePaths = await discoverRepositoryRules(root);
  let redactionApplied = false;
  const sanitize = (value: string): string => {
    const cleaned = String(redact(value));
    redactionApplied ||= cleaned !== value;
    return cleaned;
  };
  const sources: ContextSource[] = [];
  for (const path of rulePaths) {
    const info = await stat(path);
    const raw = await readFile(path, "utf8");
    const truncated = info.size > MAX_SOURCE_BYTES;
    const content = sanitize(raw).slice(0, MAX_SOURCE_BYTES);
    sources.push({ id: `rule:${relative(root, path)}`, path: relative(root, path), purpose: "rule", relevance: 1, content, ...(truncated ? { truncated: true } : {}) });
  }
  if (options.issue) sources.push({ id: "linear:issue", path: "linear", purpose: "issue", relevance: 1, content: sanitize(options.issue) });
  for (const document of options.documents ?? []) sources.push({ id: `linear:document:${document.id}`, path: document.title, purpose: "document", relevance: 0.5, content: sanitize(document.content) });
  for (const item of options.evidence ?? []) sources.push({ id: `evidence:${item.id}`, path: "evidence", purpose: "evidence", relevance: 0.5, content: sanitize(item.summary) });

  let ranked = sources.map(source => ({ ...source, relevance: options.rank?.(source) ?? source.relevance }));
  let relevanceOverride: ContextManifest["relevanceOverride"];
  if (options.jev && ranked.length > 1) {
    const decisionIssue = sanitize(options.issue ?? "");
    const issueCharacters = Math.min(decisionIssue.length, Math.floor(maxCharacters / 4));
    const candidates = boundedDecisionSources(ranked, Math.max(1, maxCharacters - issueCharacters));
    const decision = await options.jev.rankContext({ decisionId: `context-${options.executionId}`, executionId: options.executionId, kind: "context", question: "Which repository context source is most relevant to this execution?", state: { issue: decisionIssue.slice(0, issueCharacters), sources: candidates.map(source => ({ id: source.id, purpose: source.purpose, content: source.content })) }, inputs: [{ name: "execution", value: options.executionId, source: "controller" }], candidates: candidates.map(source => source.id), policyChecks: [{ name: "worktree-only", result: "pass" }] });
    if (decision.applied) ranked = ranked.map(source => ({ ...source, relevance: source.id === decision.choice ? 1 : source.relevance * 0.9 }));
  }
  if (options.rank) relevanceOverride = { source: "caller", reason: "caller rank callback applied after Jev relevance" };
  ranked.sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id));
  const compactedSources = compactContext(ranked, maxCharacters);
  const selected = new Set(compactedSources.map(source => source.id));
  const droppedSources = ranked.filter(source => !selected.has(source.id)).map(reference);
  return { executionId: options.executionId, repository: options.repository, worktree: root, sources: compactedSources, droppedSources, compacted: droppedSources.length > 0 || compactedSources.some((item, i) => item.content !== ranked[i]?.content), redacted: redactionApplied, ...(relevanceOverride ? { relevanceOverride } : {}) };
}
