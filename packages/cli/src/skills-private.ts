import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { KorConfig, KorPaths } from "@kor-code/config";
import { buildSkillsCatalogue, readSkillBundle, skillFiles } from "./skills-catalogue.js";
import { lintSkills } from "./skills-lint.js";

const git = promisify(execFile);
const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);
const PRIVATE_FILES = {
  ".gitignore": "# Private Kor guidance must stay local.\n*\n",
  "deny.txt": "# One literal, case-insensitive private string per line. Blank lines and comments are ignored.\n",
};

export function privateSkillsPath(config: KorConfig, paths: KorPaths): string {
  return config.skills?.privatePath ?? join(paths.configDir, "skills");
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (missing(error)) return false; throw error; }
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || path !== ".." && !path.startsWith("../") && !isAbsolute(path);
}

async function physicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if (!missing(error)) throw error;
    return join(await physicalPath(dirname(path)), relative(dirname(path), path));
  }
}

async function assertPrivateLocation(path: string): Promise<void> {
  let directory = path;
  while (!await exists(directory)) directory = dirname(directory);
  let worktree: string;
  try { worktree = (await git("git", ["-C", directory, "rev-parse", "--show-toplevel"], { env: { ...process.env, LC_ALL: "C" } })).stdout.trim(); }
  catch (error) {
    if (error instanceof Error && "stderr" in error && String(error.stderr).includes("not a git repository")) return;
    throw new Error("Cannot verify the private pack's Git location");
  }
  const local = relative(worktree, path);
  const tracked = await git("git", ["-C", worktree, "ls-files", "--", local]);
  if (tracked.stdout.trim()) throw new Error("Private pack contains tracked files; move it outside the worktree");
  try { await git("git", ["-C", worktree, "check-ignore", "-q", "--", `${local}/`]); }
  catch { throw new Error("Private pack must be outside a Git worktree or explicitly ignored"); }
}

export async function initPrivateSkills(path: string): Promise<void> {
  path = await physicalPath(resolve(path));
  await assertPrivateLocation(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  for (const [name, text] of Object.entries(PRIVATE_FILES)) {
    if (!await exists(join(path, name))) await writeFile(join(path, name), text, { mode: 0o600, flag: "wx" });
  }
}

async function copyBundle(source: string, destination: string): Promise<number> {
  await mkdir(destination, { mode: 0o700 });
  let bytes = 0;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Import refuses symlinks inside a skill bundle");
    if (entry.isDirectory()) bytes += await copyBundle(from, to);
    else if (entry.isFile()) {
      const content = await readFile(from);
      const mode = (await lstat(from)).mode & 0o100 ? 0o700 : 0o600;
      await writeFile(to, content, { mode, flag: "wx" });
      bytes += content.length;
    } else throw new Error("Import accepts only regular files and directories");
  }
  return bytes;
}

type ImportDiagnostic = { rule: string; severity: "error" | "warning"; message: string };
type ImportStatus = "pending" | "would-copy" | "copied" | "invalid" | "skipped" | "conflict" | "duplicate" | "not-copied";
type ImportResult = { name: string; status: ImportStatus; suggestedVisibility: "local-only"; diagnostics: ImportDiagnostic[] };

export async function importPrivateSkills(options: { config: KorConfig; paths: KorPaths; from: string; dryRun: boolean; skipInvalid?: boolean }) {
  const destination = await physicalPath(resolve(privateSkillsPath(options.config, options.paths)));
  const source = await realpath(resolve(options.from));
  const sourceRoot = (await lstat(source)).isDirectory() ? source : dirname(source);
  if (contains(sourceRoot, destination) || contains(destination, sourceRoot)) throw new Error("Import source and private pack must not overlap");
  await assertPrivateLocation(destination);
  const report = {
    schemaVersion: 1, ok: true, dryRun: options.dryRun, destination, bytes: 0,
    skills: new Array<ImportResult>(), duplicates: 0, diagnostics: new Array<ImportDiagnostic>(),
  };
  const bundled = await buildSkillsCatalogue({ ...options, from: [fileURLToPath(new URL("../../../skills", import.meta.url))], estimate: true });
  const staging = join(options.paths.stateDir, `skills-import-${randomUUID()}`);
  const selected = new Map<string, { hash: string; result: ImportResult; bytes: number }>();
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    for (const file of await skillFiles(source)) {
      const result: ImportResult = { name: basename(dirname(file)), status: "pending", suggestedVisibility: "local-only", diagnostics: [] };
      report.skills.push(result);
      try {
        const skill = await readSkillBundle(file, "private");
        result.name = skill.header.name;
        const previous = selected.get(result.name);
        if (previous) {
          if (previous.hash === skill.hash) {
            result.status = "duplicate";
            report.duplicates++;
          } else {
            result.status = previous.result.status = "conflict";
            const diagnostic: ImportDiagnostic = { severity: "error", rule: "name-collision", message: "Different source bundles use the same name" };
            result.diagnostics.push(diagnostic);
            previous.result.diagnostics.push(diagnostic);
          }
          continue;
        }
        selected.set(result.name, { hash: skill.hash, result, bytes: 0 });
        if (bundled.skills.some(publicSkill => publicSkill.name === result.name && publicSkill.hash === skill.hash)) {
          result.status = "conflict";
          result.diagnostics.push({ severity: "error", rule: "public-name", message: "Identical to the public bundle; no private copy is needed" });
        }
        if (bundled.skills.some(publicSkill => publicSkill.name === result.name && publicSkill.hash !== skill.hash) && skill.header.metadata?.["kor.overrides"] !== "public") {
          result.diagnostics.push({ severity: "warning", rule: "name-collision", message: "Bundled public skill remains active; set metadata.kor.overrides: public in the private skill to replace it" });
        }
        if (await exists(join(destination, result.name))) {
          result.status = "conflict";
          result.diagnostics.push({ severity: "error", rule: "destination-exists", message: "Destination exists; import never overwrites" });
        }
        if (result.status !== "pending") continue;
        const bytes = await copyBundle(dirname(file), join(staging, result.name));
        const lint = await lintSkills(staging, { private: true, names: [result.name] });
        result.diagnostics.push(...lint.diagnostics.map(item => ({ rule: item.rule, severity: item.severity, message: `${item.file}:${item.line}: ${item.message}` })));
        if (!lint.ok) result.status = "invalid";
        else selected.set(result.name, { hash: skill.hash, result, bytes });
      } catch (error) {
        result.status = "invalid";
        result.diagnostics.push({ severity: "error", rule: "skill-format", message: error instanceof Error && error.name !== "YAMLParseError" ? error.message : "Invalid YAML frontmatter" });
      }
    }
    if (!report.skills.length) {
      report.ok = false;
      report.diagnostics.push({ severity: "error", rule: "empty-import", message: "No skills found in the explicit source" });
    }
    report.diagnostics.push(...report.skills.flatMap(skill => skill.diagnostics.map(item => ({ ...item, message: `${skill.name}: ${item.message}` }))));
    const invalid = report.skills.filter(skill => skill.status === "invalid" || skill.status === "conflict");
    if (options.skipInvalid) {
      for (const skill of invalid) skill.status = "skipped";
    } else if (invalid.length) report.ok = false;
    const ready = [...selected.values()].filter(skill => skill.result.status === "pending");
    if (!ready.length && invalid.length) report.ok = false;
    for (const skill of ready) {
      skill.result.status = report.ok ? "would-copy" : "not-copied";
      if (report.ok) report.bytes += skill.bytes;
    }
    if (!report.ok || options.dryRun) return report;
    await initPrivateSkills(destination);
    for (const skill of ready) {
      if (await exists(join(destination, skill.result.name))) throw new Error("Import destination changed during validation; no overwrite permitted");
      await copyBundle(join(staging, skill.result.name), join(destination, skill.result.name));
      skill.result.status = "copied";
    }
    return report;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function guardPrivateSkills(options: { privatePath: string; publicPath: string }) {
  const diagnostics: { rule: string; file: string; message: string }[] = [];
  const privatePath = await physicalPath(resolve(options.privatePath));
  const publicPath = await realpath(resolve(options.publicPath));
  if (contains(publicPath, privatePath) || contains(privatePath, publicPath)) diagnostics.push({ rule: "private-location", file: "", message: "Public and private tiers must not overlap" });
  try { await assertPrivateLocation(privatePath); }
  catch (error) { diagnostics.push({ rule: "private-location", file: "", message: error instanceof Error ? error.message : "Cannot verify private pack location" }); }
  const denied = new Set<string>();
  const names = new Set<string>();
  if (await exists(privatePath)) {
    const publicFiles = await skillFiles(publicPath);
    const publicNames = new Set(await Promise.all(publicFiles.map(async file => {
      const skill = await readSkillBundle(file, "public");
      return skill.header.name;
    })));
    for (const file of await skillFiles(privatePath)) {
      const skill = await readSkillBundle(file, "private");
      if (!publicNames.has(skill.header.name)) names.add(basename(dirname(file)).toLowerCase());
    }
    try {
      for (const line of (await readFile(join(privatePath, "deny.txt"), "utf8")).split(/\r?\n/)) {
        if (line.trim() && !line.trim().startsWith("#")) denied.add(line.trim().toLowerCase());
      }
    } catch (error) { if (!missing(error)) throw error; }
  }
  let files = 0;
  const namePatterns = [...names].map(name => new RegExp(`(?<![a-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_-])`, "i"));
  async function scan(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const file = relative(publicPath, path);
      if (entry.isSymbolicLink()) {
        diagnostics.push({ rule: "symlink", file: "[redacted]", message: "Public tier must not contain symlinks" });
        continue;
      }
      if (entry.isDirectory()) await scan(path);
      const text = `${file}\n${entry.isFile() ? await readFile(path, "utf8") : ""}`;
      const privateMatch = namePatterns.some(pattern => pattern.test(text)) || [...denied].some(value => text.toLowerCase().includes(value));
      if (privateMatch) diagnostics.push({ rule: "private-string", file: "[redacted]", message: "Public path or content matches a private name or deny.txt entry" });
      if (/(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|[A-Z]:[\\/]Users[\\/][^\\/\s]+)/i.test(text)) diagnostics.push({ rule: "home-path", file: privateMatch ? "[redacted]" : file, message: "Public tier contains an absolute home path" });
      if (entry.isFile()) files++;
    }
  }
  await scan(publicPath);
  return { schemaVersion: 1, ok: diagnostics.length === 0, files, privateNames: names.size, diagnostics };
}
