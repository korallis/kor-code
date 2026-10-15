import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { fingerprint } from "./install-journal.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
export const skillNameSchema = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const subpathSchema = z.string().min(1).refine(value => !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part && part !== "." && part !== ".."));
export const skillLockEntrySchema = z.strictObject({
  name: skillNameSchema,
  url: z.string().url(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  subpath: subpathSchema,
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  license: z.string().min(1),
  licenseFile: subpathSchema,
  licenseHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  adaptFrontmatter: z.boolean(),
});
export type SkillLockEntry = z.infer<typeof skillLockEntrySchema>;
export type SkillTier = "public" | "private";

export function sourceUrl(input: string, tier: SkillTier): string {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash || !["https:", "file:"].includes(url.protocol)) throw new Error("Use a credential-free HTTPS Git URL (or file:// for a private local source)");
  if (url.protocol === "file:" && (tier !== "private" || url.hostname && url.hostname !== "localhost")) throw new Error("Local sources are allowed only in the private tier");
  return url.href;
}

export async function git(directory: string, args: string[]): Promise<string> {
  try {
    return (await execFileAsync("git", args, {
      cwd: directory, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_GIT_OUTPUT,
      env: { PATH: process.env.PATH, HOME: directory, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
    })).stdout.trim();
  } catch { throw new Error(`Git ${args[0]} failed; check the source URL and commit (upstream output withheld)`); }
}

export async function fetchSource(directory: string, url: string, pin: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await git(directory, ["init", "-q", "--template="]);
  let commit = pin;
  if (pin !== "HEAD" && !/^[a-f0-9]{7,40}$/.test(pin)) throw new Error("Pin the source to a 7–40 character commit SHA");
  if (pin !== "HEAD" && pin.length < 40) {
    const refs = await git(directory, ["ls-remote", url]);
    const matches = [...new Set(refs.split("\n").map(line => line.split(/\s/)[0] ?? "").filter(sha => sha.startsWith(pin)))];
    if (matches.length === 1 && matches[0]) commit = matches[0];
    else {
      const github = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
      if (!github) throw new Error("This abbreviated commit is not advertised by the remote; use its full SHA");
      const response = await fetch(`https://api.github.com/repos/${github[1]}/${github[2]}/commits/${pin}`, { signal: AbortSignal.timeout(GIT_TIMEOUT_MS), headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error("Cannot resolve the abbreviated GitHub commit; use its full SHA");
      const resolved = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }).parse(await response.json());
      if (!resolved.sha.startsWith(pin)) throw new Error("Resolved commit does not match the requested pin");
      commit = resolved.sha;
    }
  }
  await git(directory, ["-c", "core.hooksPath=/dev/null", "fetch", "--depth=1", "--no-tags", url, commit]);
  const sha = await git(directory, ["rev-parse", "FETCH_HEAD"]);
  if (pin !== "HEAD" && !sha.startsWith(pin)) throw new Error("Fetched commit does not match the requested pin");
  await git(directory, ["-c", "core.hooksPath=/dev/null", "checkout", "-q", "--detach", "FETCH_HEAD"]);
  return sha;
}

export async function discoverSkills(repository: string, subpath: string | undefined): Promise<Map<string, string[]>> {
  const root = subpath ? join(repository, subpathSchema.parse(subpath)) : repository;
  await rejectLinks(root, repository);
  const skills = new Map<string, string[]>();
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some(entry => entry.name === "SKILL.md" && entry.isFile())) {
      const name = directory.split("/").at(-1) ?? "";
      if (skillNameSchema.safeParse(name).success) skills.set(name, [...skills.get(name) ?? [], relative(repository, directory)]);
      return;
    }
    for (const entry of entries) if (entry.isDirectory() && entry.name !== ".git") await visit(join(directory, entry.name));
  }
  await visit(root);
  return skills;
}

async function rejectLinks(path: string, stop: string): Promise<void> {
  for (let current = resolve(path); ; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Source paths cannot contain symlinks");
    if (current === resolve(stop)) break;
  }
}

async function validateBundle(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await validateBundle(join(directory, entry.name));
    else if (!entry.isFile()) throw new Error("Source bundles must contain ordinary files and directories only");
  }
}

const PERMISSIVE_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0"]);
export function permissiveLicense(license: string): boolean { return PERMISSIVE_LICENSES.has(license); }
function licenseIdentifier(text: string): string {
  if (/MIT License/i.test(text) && /Permission is hereby granted, free of charge/.test(text)) return "MIT";
  if (/Apache License/.test(text) && /Version 2\.0/.test(text)) return "Apache-2.0";
  if (/Redistribution and use in source and binary forms/.test(text)) return /Neither the name/.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  if (/Zero-Clause BSD/.test(text)) return "0BSD";
  if (/Permission to use, copy, modify, and\/or distribute this software/.test(text)) return "ISC";
  if (/This is free and unencumbered software released into the public domain/.test(text)) return "Unlicense";
  if (/CC0 1\.0 Universal/.test(text)) return "CC0-1.0";
  return "UNKNOWN";
}

export async function stageSkill(options: { repository: string; staging: string; url: string; commit: string; subpath: string; adaptFrontmatter: boolean }): Promise<SkillLockEntry> {
  const subpath = subpathSchema.parse(options.subpath);
  const name = skillNameSchema.parse(subpath.split("/").at(-1));
  const source = join(options.repository, subpath);
  await rejectLinks(source, options.repository);
  await validateBundle(source);
  let licenseFile: string | undefined;
  for (let current = source; ; current = dirname(current)) {
    const candidates = (await readdir(current, { withFileTypes: true })).filter(entry => entry.isFile() && /^(?:LICENSE|LICENCE|COPYING)(?:\.(?:md|txt))?$/i.test(entry.name));
    if (candidates.length > 1) throw new Error(`Multiple licence files for ${name}; review the source before importing`);
    if (candidates[0]) { licenseFile = join(current, candidates[0].name); break; }
    if (current === options.repository) break;
  }
  if (!licenseFile) throw new Error(`No licence file found for ${name}`);
  const licenseText = await readFile(licenseFile);
  const license = licenseIdentifier(licenseText.toString("utf8"));
  const target = join(options.staging, name);
  await cp(source, target, { recursive: true, verbatimSymlinks: true });
  await writeFile(join(target, "LICENSE.upstream"), licenseText);
  if (options.adaptFrontmatter) {
    const file = join(target, "SKILL.md");
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    const header = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!header) throw new Error(`Missing frontmatter: ${name}`);
    const data = z.record(z.string(), z.unknown()).parse(parse(header[1] ?? "", { uniqueKeys: true, maxAliasCount: 0 }));
    if (typeof data.description === "string" && !/^[A-Z][a-z]+s\b/.test(data.description)) {
      const trigger = data.description.replace(/^Apply (?:when|before)\s+/i, "").replace(/^Use (?:when|for)\s+/i, "");
      data.description = `Guides development. Use when ${trigger.charAt(0).toLowerCase()}${trigger.slice(1)}`;
    }
    data.license ??= license;
    await writeFile(file, `---\n${stringify(data)}---\n${text.slice(header[0].length)}`);
  }
  const hash = await fingerprint(target);
  if (!hash) throw new Error(`Cannot hash staged skill: ${name}`);
  return { name, url: options.url, commit: options.commit, subpath, hash: `sha256:${hash}`, license, licenseFile: relative(options.repository, licenseFile), licenseHash: `sha256:${createHash("sha256").update(licenseText).digest("hex")}`, adaptFrontmatter: options.adaptFrontmatter };
}
