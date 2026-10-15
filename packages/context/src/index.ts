import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { open, realpath, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import type { ContextManifest, ContextSource, ContextSourceReference } from "@kor-code/core";
import { JevUnavailableError, redact, type JevDecisionCore } from "@kor-code/jev";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { downloadScreens, type TicketImage } from "./screens.js";
export { ticketImages } from "./screens.js";
export { contextPrompt } from "./prompt.js";

const execFile = promisify(execFileCallback);
const MAX_FILE_HINTS = 40;
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
    if (entry.isDirectory() && (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".kor")) continue;
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
  task?: string;
  includeFiles?: boolean;
  images?: readonly TicketImage[];
  issueIdentifier?: string;
  fetchImage?: (url: string) => Promise<Response>;
  documents?: readonly { id: string; title: string; content: string }[];
  evidence?: readonly { id: string; summary: string }[];
  maxCharacters?: number;
  maxSourceCharacters?: number;
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
  const maxSourceCharacters = options.maxSourceCharacters;
  if (maxSourceCharacters !== undefined && (!Number.isSafeInteger(maxSourceCharacters) || maxSourceCharacters < 1)) throw new Error("Source character limit must be positive");
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
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let raw: string;
    let truncated: boolean;
    try {
      const buffer = Buffer.alloc(MAX_SOURCE_BYTES);
      const result = await file.read(buffer, 0, buffer.length, 0);
      raw = buffer.subarray(0, result.bytesRead).toString("utf8");
      truncated = (await file.stat()).size > MAX_SOURCE_BYTES;
    } finally { await file.close(); }
    const content = sanitize(raw);
    sources.push({ id: `rule:${relative(root, path)}`, path: relative(root, path), purpose: "rule", relevance: 1, content, ...(truncated ? { truncated: true } : {}) });
  }
  if (options.issue) sources.push({ id: "linear:issue", path: "linear", purpose: "issue", relevance: 1, content: sanitize(options.issue) });
  for (const document of options.documents ?? []) sources.push({ id: `linear:document:${document.id}`, path: document.title, purpose: "document", relevance: 0.5, content: sanitize(document.content) });
  for (const item of options.evidence ?? []) sources.push({ id: `evidence:${item.id}`, path: "evidence", purpose: "evidence", relevance: 0.5, content: sanitize(item.summary) });

  if (options.includeFiles) {
    let files: string[] = [];
    try { files = (await execFile("git", ["-C", root, "ls-files", "-z"], { maxBuffer: 4 * 1024 * 1024 })).stdout.split("\0").filter(Boolean); }
    catch (error) { if (!(error instanceof Error && "code" in error && typeof error.code === "number")) throw error; }
    const terms = new Set((options.task ?? options.issue ?? "").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []);
    const score = (path: string) => (path.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []).filter(word => terms.has(word)).length;
    const hints = files.filter(path => !isRuleFile(root, resolve(root, path)) && !path.startsWith(".kor/") && inside(root, resolve(root, path)))
      .sort((a, b) => score(b) - score(a) || a.localeCompare(b)).slice(0, MAX_FILE_HINTS);
    for (const path of hints) sources.push({ id: `file:${path}`, path: sanitize(path), purpose: "file", relevance: 0.1, content: sanitize(path) });
  }
  for (const [index, image] of (options.images ?? []).entries()) sources.push({ id: `image:${index}`, path: "ticket", purpose: "image", relevance: 0.5, content: sanitize(image.title) });

  let ranked = sources.map(source => ({ ...source, relevance: options.rank?.(source) ?? source.relevance }));
  let relevanceOverride: ContextManifest["relevanceOverride"];
  if (options.jev && ranked.length > 1) {
    const decisionIssue = sanitize(options.task ?? options.issue ?? "");
    const issueCharacters = Math.min(decisionIssue.length, Math.floor(maxCharacters / 4));
    const candidates = boundedDecisionSources(ranked, Math.max(1, maxCharacters - issueCharacters));
    try {
      const decision = await options.jev.rankContext({ decisionId: `context-${options.executionId}-${randomUUID()}`, executionId: options.executionId, kind: "context", question: "Which repository context source is most relevant to this execution?", threshold: 0, state: { issue: decisionIssue.slice(0, issueCharacters), sources: candidates.map(source => ({ id: source.id, path: source.path, purpose: source.purpose, content: source.content })) }, inputs: [{ name: "execution", value: options.executionId, source: "controller" }], candidates: candidates.map(source => source.id), policyChecks: [{ name: "worktree-only", result: "pass" }] });
      if (decision.applied) ranked = ranked.map(source => ({ ...source, relevance: decision.probabilities?.[source.id] ?? (source.id === decision.choice ? 1 : 0) }));
    } catch (error) { if (!(error instanceof JevUnavailableError)) throw error; }
  }
  if (options.rank) relevanceOverride = { source: "caller", reason: "caller rank callback applied before Jev relevance" };
  ranked.sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id));
  const withScreens = await downloadScreens(ranked, { root, issue: options.issueIdentifier ?? options.executionId, images: options.images ?? [], ...(options.fetchImage ? { fetchImage: options.fetchImage } : {}) });
  const excerpts = maxSourceCharacters === undefined ? withScreens : withScreens.map(source => ({ ...source, content: source.content.slice(0, maxSourceCharacters), truncated: source.truncated || source.content.length > maxSourceCharacters }));
  const compactedSources = compactContext(excerpts, maxCharacters);
  const selected = new Set(compactedSources.map(source => source.id));
  const droppedSources = ranked.filter(source => !selected.has(source.id)).map(reference);
  return { executionId: options.executionId, repository: options.repository, worktree: root, sources: compactedSources, droppedSources, compacted: droppedSources.length > 0 || compactedSources.some((item, i) => item.content !== ranked[i]?.content), redacted: redactionApplied, ...(relevanceOverride ? { relevanceOverride } : {}) };
}
