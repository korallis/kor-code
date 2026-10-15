import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runtimePaths } from "@kor-code/config";
import { z } from "zod";
import { checkRestore, fingerprint, manifestSchema, missing, mkdirRecorded, recordAfter, remember, restoreManifest, saveManifest, type InstallManifest } from "./install-journal.js";
import { formatSkillLint, lintSkills } from "./skills-lint.js";
import { discoverSkills, fetchSource, permissiveLicense, skillLockEntrySchema, skillNameSchema, sourceUrl, stageSkill, type SkillLockEntry, type SkillTier } from "./skills-source.js";

const execFileAsync = promisify(execFile);
const PUBLIC_ROOT = fileURLToPath(new URL("../../../skills", import.meta.url));
const LOCK_NAME = "skills.lock.json";
const SOURCES_NAME = "SOURCES.md";
const MAX_DIFF_OUTPUT = 1024 * 1024;
const lockSchema = z.strictObject({ schemaVersion: z.literal(1), skills: z.array(skillLockEntrySchema) });
const journalSchema = z.strictObject({ schemaVersion: z.literal(1), installation: manifestSchema, transaction: manifestSchema.optional() });
type Journal = z.infer<typeof journalSchema>;
const tierSchema = z.enum(["public", "private"]);
export const SKILLS_INSTALL_USAGE = "kor skills add <git-url>@<commit> [--skill NAME ...] [--subpath PATH] --tier public|private [--adapt-frontmatter] [--json] | kor skills update [--check|--apply] [--tier public|private] [--skill NAME ...] [--commit SHA] [--json]";
export class SkillsUsageError extends Error {}
type Options = { skills: string[] } & (
  { kind: "add"; url: string; commit: string; tier: SkillTier; subpath: string | undefined; adaptFrontmatter: boolean } |
  { kind: "update"; mode: "check" | "apply"; tiers: SkillTier[]; commit: string }
);

function parseOptions(args: readonly string[]): Options {
  const kind = args[0];
  let tier: SkillTier | undefined;
  let subpath: string | undefined;
  let commit = "HEAD";
  let mode: "check" | "apply" = "check";
  let adaptFrontmatter = false;
  const skills: string[] = [];
  const seen = new Set<string>();
  let index = kind === "add" ? 2 : 1;
  function invalid(): never { throw new SkillsUsageError(SKILLS_INSTALL_USAGE); }
  for (; index < args.length; index++) {
    const flag = args[index] ?? "";
    if (seen.has(flag) && flag !== "--skill") invalid();
    seen.add(flag);
    if (flag === "--json") continue;
    if (flag === "--adapt-frontmatter" && kind === "add") { adaptFrontmatter = true; continue; }
    if ((flag === "--check" || flag === "--apply") && kind === "update") { mode = flag === "--check" ? "check" : "apply"; continue; }
    const value = args[++index];
    if (!value || value.startsWith("-")) invalid();
    if (flag === "--tier") { const parsed = tierSchema.safeParse(value); if (!parsed.success) invalid(); tier = parsed.data; }
    else if (flag === "--subpath" && kind === "add") subpath = value;
    else if (flag === "--commit" && kind === "update") { if (!/^[a-f0-9]{7,40}$/.test(value)) invalid(); commit = value; }
    else if (flag === "--skill") {
      if (!skillNameSchema.safeParse(value).success) invalid();
      skills.push(value);
      while (args[index + 1] && !args[index + 1]?.startsWith("-")) {
        const name = args[++index];
        if (!name || !skillNameSchema.safeParse(name).success) invalid();
        skills.push(name);
      }
    } else invalid();
  }
  if (seen.has("--check") && seen.has("--apply")) invalid();
  const common = { skills: [...new Set(skills)] };
  if (kind === "add") {
    const pin = /^(.*)@([a-f0-9]{7,40})$/.exec(args[1] ?? "");
    if (!pin?.[1] || !pin[2] || !tier) invalid();
    let url: string;
    try { url = sourceUrl(pin[1], tier); }
    catch (error) { throw new SkillsUsageError(error instanceof Error ? error.message : SKILLS_INSTALL_USAGE); }
    return { ...common, kind, url, commit: pin[2], tier, subpath, adaptFrontmatter };
  }
  if (kind !== "update") invalid();
  return { ...common, kind, mode, tiers: tier ? [tier] : ["public", "private"], commit };
}

function tierRoot(tier: SkillTier): string { return tier === "public" ? PUBLIC_ROOT : join(runtimePaths().configDir, "skills"); }
function journalRoot(): string { return `${runtimePaths().stateDir}-install/skills`; }
function journalPath(): string { return join(journalRoot(), "manifest.json"); }
function contains(parent: string, path: string): boolean {
  const within = relative(parent, path);
  return within === "" || within !== ".." && !within.startsWith("../") && !within.startsWith("/");
}

async function safePath(path: string): Promise<void> {
  if (resolve(path).split("/").some(part => [".claude", ".codex", ".agents"].includes(part))) throw new Error("Skills destinations cannot use harness configuration directories");
  for (let current = resolve(path); ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Skills destination cannot contain symlinks: ${current}`); }
    catch (error) { if (!missing(error)) throw error; }
    if (current === dirname(current)) break;
  }
}

async function readLock(tier: SkillTier): Promise<SkillLockEntry[]> {
  const file = join(tierRoot(tier), LOCK_NAME);
  await safePath(file);
  try {
    const lock = lockSchema.parse(JSON.parse(await readFile(file, "utf8")));
    if (new Set(lock.skills.map(entry => entry.name)).size !== lock.skills.length) throw new Error("Duplicate names in skills lockfile");
    for (const entry of lock.skills) sourceUrl(entry.url, tier);
    return lock.skills;
  } catch (error) { if (missing(error)) return []; throw error; }
}

async function readJournal(): Promise<Journal | undefined> {
  await safePath(journalPath());
  try {
    const journal = journalSchema.parse(JSON.parse(await readFile(journalPath(), "utf8")));
    for (const manifest of [journal.installation, ...(journal.transaction ? [journal.transaction] : [])]) {
      if (!contains(journalRoot(), manifest.backupDir)) throw new Error("Invalid skills backup directory");
      await safePath(manifest.backupDir);
      for (const entry of manifest.entries) {
        const allowed = ["public", "private"].some(tier => {
          const child = relative(tierRoot(tierSchema.parse(tier)), entry.path);
          return !child.includes("/") && (skillNameSchema.safeParse(child).success || [LOCK_NAME, SOURCES_NAME].includes(child));
        });
        if (!allowed || entry.policy !== "shared" || !contains(manifest.backupDir, entry.backup) || entry.afterBackup && !contains(manifest.backupDir, entry.afterBackup)) throw new Error("Invalid skills journal entry");
        await safePath(entry.path);
        await safePath(entry.backup);
        if (entry.afterBackup) await safePath(entry.afterBackup);
      }
      for (const path of manifest.createdDirectories) {
        if (![tierRoot("public"), tierRoot("private")].some(root => contains(path, root)) || path === "/") throw new Error("Invalid skills directory journal");
        await safePath(path);
      }
    }
    return journal;
  } catch (error) { if (missing(error)) return undefined; throw error; }
}

async function saveJournal(journal: Journal): Promise<void> {
  await writeFile(`${journalPath()}.tmp`, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  await rename(`${journalPath()}.tmp`, journalPath());
}

async function withSkillsLock<T>(work: () => Promise<T>): Promise<T> {
  const path = `${journalRoot()}.busy`;
  await safePath(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try { await writeFile(path, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    throw new Error(`Skills operation lock exists: ${path}; wait for its owner to finish, or confirm the recorded PID exited before removing a stale lock`);
  }
  try { return await work(); } finally { await rm(path, { force: true }); }
}

function newManifest(backupDir: string): InstallManifest {
  return { version: 1, phase: "preparing", scope: "user", pilot: dirname(PUBLIC_ROOT), claudeConfigDir: "", backupDir, systemd: false, entries: [], createdDirectories: [] };
}

function sourcesMarkdown(skills: SkillLockEntry[]): string {
  return ["# Third-party skills", "", "Generated by `kor skills add` / `update`. Review upstream licences before use.", "", ...skills.flatMap(entry => [
    `## ${entry.name}`, "", `Source: ${entry.url}`, `Commit: ${entry.commit}`, `Subpath: ${entry.subpath}`, `Licence: ${entry.license} (${entry.licenseFile}; bundled as LICENSE.upstream)`, `Content: ${entry.hash}`, `Frontmatter adaptation: ${entry.adaptFrontmatter ? "enabled" : "disabled"}`, "",
  ])].join("\n");
}

type Change = { tier: SkillTier; entry: SkillLockEntry; previous: SkillLockEntry | undefined; staging: string; diffStat: string; licenseStatus: "unchanged" | "changed" | "new" };

async function diffStat(before: string, after: string): Promise<string> {
  let output: string;
  try { output = (await execFileAsync("git", ["--no-pager", "diff", "--no-index", "--numstat", "-z", "--no-renames", "--", before, after], { maxBuffer: MAX_DIFF_OUTPUT })).stdout; }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === 1 && "stdout" in error && typeof error.stdout === "string")) throw new Error("Cannot compute skills diff stat");
    output = error.stdout;
  }
  const fields = output.split("\0");
  const rows: string[] = [];
  for (let index = 0; index < fields.length && fields[index]; index++) {
    const [added, removed, path] = fields[index]!.split("\t");
    const paths = path ? [path] : [fields[++index] ?? "", fields[++index] ?? ""];
    const labels = paths.map(value => value.replaceAll(before, "installed").replaceAll(after, "upstream"));
    rows.push(`+${added} -${removed} ${labels.map(value => JSON.stringify(value)).join(" -> ")}`);
  }
  return rows.join("\n") || "No content changes";
}

async function applyChanges(changes: Change[], initialTiers: Map<SkillTier, string | null>): Promise<void> {
  for (const [tier, hash] of initialTiers) {
    if (await fingerprint(tierRoot(tier)) !== hash) throw new Error("Skills tier changed while preparing the import; retry with the current files");
  }
  const old = await readJournal();
  if (old?.transaction) throw new Error("Interrupted skills transaction; run kor uninstall to recover before retrying");
  if (old) await checkRestore(old.installation, false);
  const id = randomUUID();
  const installation = old ? structuredClone(old.installation) : newManifest(join(journalRoot(), "original"));
  const transaction = newManifest(join(journalRoot(), "history", id));
  await mkdir(installation.backupDir, { recursive: true, mode: 0o700 });
  await mkdir(transaction.backupDir, { recursive: true, mode: 0o700 });
  const tiers = [...new Set(changes.map(change => change.tier))];
  const paths = [...changes.map(change => join(tierRoot(change.tier), change.entry.name)), ...tiers.flatMap(tier => [join(tierRoot(tier), LOCK_NAME), join(tierRoot(tier), SOURCES_NAME)])];
  for (const change of changes) {
    const current = await fingerprint(join(tierRoot(change.tier), change.entry.name));
    const locked = (await readLock(change.tier)).find(entry => entry.name === change.entry.name);
    if (current !== (change.previous?.hash.slice("sha256:".length) ?? null) || JSON.stringify(locked) !== JSON.stringify(change.previous)) throw new Error("Skills changed while preparing the import; retry with the current lockfile");
  }
  for (const path of paths) {
    await safePath(path);
    await remember(transaction, path);
    if (!installation.entries.some(entry => entry.path === path)) await remember(installation, path);
  }
  await saveJournal({ schemaVersion: 1, installation, transaction });
  try {
    for (const tier of tiers) {
      const root = tierRoot(tier);
      await mkdirRecorded(transaction, root);
      await saveJournal({ schemaVersion: 1, installation, transaction });
      const entries = await readLock(tier);
      for (const change of changes.filter(change => change.tier === tier)) {
        const target = join(root, change.entry.name);
        await rm(target, { recursive: true, force: true });
        await cp(join(change.staging, change.entry.name), target, { recursive: true });
        const index = entries.findIndex(entry => entry.name === change.entry.name);
        if (index < 0) entries.push(change.entry); else entries[index] = change.entry;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      await writeFile(join(root, LOCK_NAME), `${JSON.stringify({ schemaVersion: 1, skills: entries }, null, 2)}\n`, { mode: 0o600 });
      await writeFile(join(root, SOURCES_NAME), sourcesMarkdown(entries), { mode: 0o600 });
    }
    await recordAfter(transaction);
    transaction.phase = "installed";
    await saveManifest(join(transaction.backupDir, "manifest.json"), transaction);
    installation.createdDirectories.push(...transaction.createdDirectories);
    await recordAfter(installation);
    installation.phase = "installed";
    await saveJournal({ schemaVersion: 1, installation });
  } catch (error) {
    await restoreManifest(transaction, false);
    if (old) await saveJournal(old); else await rm(journalPath(), { force: true });
    throw error;
  }
}

async function restoreSkills(options: { purge: boolean }): Promise<string | undefined> {
  const journal = await readJournal();
  if (!journal) return undefined;
  if (journal.transaction) {
    if (options.purge) journal.transaction.phase = "restoring";
    await checkRestore(journal.transaction, false);
    await restoreManifest(journal.transaction, false);
    delete journal.transaction;
    journal.installation.phase = "preparing";
    await saveJournal(journal);
  }
  const kept: InstallManifest["entries"] = [];
  if (!options.purge) {
    for (const entry of journal.installation.entries) {
      const current = await fingerprint(entry.path);
      if (current !== entry.before && current !== entry.after) kept.push(entry);
    }
  }
  journal.installation.phase = "restoring";
  const restoration = {
    ...journal.installation,
    entries: journal.installation.entries.filter(entry => !kept.includes(entry)),
  };
  await checkRestore(restoration, false);
  await saveJournal(journal);
  await restoreManifest(restoration, false);
  if (kept.length) {
    journal.installation.phase = "installed";
    await saveJournal(journal);
    return `WARNING: Kept locally edited imported paths: ${kept.map(entry => entry.path).join(", ")}. Run kor uninstall --purge to remove imported copies and restore originals.`;
  }
  await rm(journalRoot(), { recursive: true });
  return options.purge
    ? "WARNING: Purged imported skills, including local edits; original tier files restored."
    : "Imported skills uninstalled; original tier files restored.";
}

export async function uninstallSkills(options: { purge: boolean }): Promise<string | undefined> {
  if (!await readJournal()) return undefined;
  return withSkillsLock(() => restoreSkills(options));
}

export async function runSkillsInstall(args: readonly string[]): Promise<{ ok: boolean; output: string; report: unknown }> {
  const options = parseOptions(args);
  const publicRoot = tierRoot("public");
  const privateRoot = tierRoot("private");
  const roots = [publicRoot, privateRoot, journalRoot()];
  if (roots.some((root, index) => roots.some((other, otherIndex) => index !== otherIndex && contains(root, other)))) throw new Error("Public skills, private skills and the install journal must be separate");
  await safePath(journalRoot());
  const existing = await readJournal();
  if (existing?.transaction) throw new Error("Interrupted skills transaction; run kor uninstall to recover");
  const workspace = await mkdtemp(join(tmpdir(), "kor-skills-"));
  const changes: Change[] = [];
  const lintReports = [];
  const initialTiers = new Map<SkillTier, string | null>();
  try {
    const fetched = new Map<string, { repository: string; commit: string }>();
    async function fetchOnce(url: string, pin: string): Promise<{ repository: string; commit: string }> {
      const key = `${url}@${pin}`;
      const previous = fetched.get(key);
      if (previous) return previous;
      const repository = join(workspace, `source-${fetched.size}`);
      const commit = await fetchSource(repository, url, pin);
      const result = { repository, commit };
      fetched.set(key, result);
      return result;
    }
    const tiers = options.kind === "add" ? [options.tier] : options.tiers;
    for (const tier of tiers) {
      await safePath(tierRoot(tier));
      initialTiers.set(tier, await fingerprint(tierRoot(tier)));
      const entries = await readLock(tier);
      const staging = join(workspace, tier, "selected");
      await mkdir(staging, { recursive: true });
      const requests: { url: string; pin: string; subpath: string; adaptFrontmatter: boolean; previous: SkillLockEntry | undefined }[] = [];
      if (options.kind === "add") {
        const source = await fetchOnce(options.url, options.commit);
        const discovered = await discoverSkills(source.repository, options.subpath);
        const names = options.skills.length ? options.skills : [...discovered.keys()].sort();
        if (!names.length) throw new Error("No source skills found");
        for (const name of names) {
          if (entries.some(entry => entry.name === name) || await fingerprint(join(tierRoot(tier), name)) !== null) throw new Error(`Skill ${name} already exists; use update for locked skills`);
          const matches = discovered.get(name);
          if (matches?.length !== 1 || !matches[0]) throw new Error(`Skill ${name} is missing or ambiguous; narrow the source with --subpath`);
          requests.push({ url: options.url, pin: options.commit, subpath: matches[0], adaptFrontmatter: options.adaptFrontmatter, previous: undefined });
        }
      } else {
        for (const entry of entries.filter(entry => !options.skills.length || options.skills.includes(entry.name))) {
          const installed = await fingerprint(join(tierRoot(tier), entry.name));
          if (`sha256:${installed}` !== entry.hash) throw new Error(`Installed skill ${entry.name} differs from its lock; save your edits before updating`);
          requests.push({ url: sourceUrl(entry.url, tier), pin: options.commit, subpath: entry.subpath, adaptFrontmatter: entry.adaptFrontmatter, previous: entry });
        }
      }
      for (const request of requests) {
        const source = await fetchOnce(request.url, request.pin);
        const entry = await stageSkill({ ...source, staging, url: request.url, subpath: request.subpath, adaptFrontmatter: request.adaptFrontmatter });
        const previous = request.previous;
        changes.push({ tier, entry, previous, staging,
          diffStat: previous ? await diffStat(join(tierRoot(tier), entry.name), join(staging, entry.name)) : "New skill bundle",
          licenseStatus: !previous ? "new" : previous.licenseHash === entry.licenseHash && previous.license === entry.license && previous.licenseFile === entry.licenseFile ? "unchanged" : "changed",
        });
      }
      if (requests.length) {
        const combined = join(workspace, tier, "combined");
        if (await fingerprint(tierRoot(tier)) !== null) await cp(tierRoot(tier), combined, { recursive: true, verbatimSymlinks: true });
        else await mkdir(combined);
        for (const change of changes.filter(change => change.tier === tier)) {
          await rm(join(combined, change.entry.name), { recursive: true, force: true });
          await cp(join(staging, change.entry.name), join(combined, change.entry.name), { recursive: true });
        }
        lintReports.push(await lintSkills(combined, { private: tier === "private" }));
      }
    }
    if (options.kind === "update" && options.skills.some(name => !changes.some(change => change.entry.name === name))) throw new Error("A requested skill is not locked in the selected tiers");
    const licenseAllowed = changes.every(change => change.tier === "private" || permissiveLicense(change.entry.license));
    const ok = lintReports.every(report => report.ok) && licenseAllowed;
    const writable = options.kind === "add" || options.mode === "apply";
    const delta = changes.filter(change => !change.previous || JSON.stringify(change.previous) !== JSON.stringify(change.entry));
    if (writable && !licenseAllowed) throw new Error("Public imports require a recognised permissive licence; no installed files changed. Use update --check to review the licence status");
    if (writable && !ok) throw new Error(`Skills lint failed; no installed files changed.\n${lintReports.filter(report => !report.ok).map(formatSkillLint).join("\n")}`);
    if (writable && delta.length) {
      await withSkillsLock(async () => {
        await mkdir(journalRoot(), { recursive: true, mode: 0o700 });
        await applyChanges(delta, initialTiers);
      });
    }
    const report = { schemaVersion: 1, ok, applied: writable && delta.length > 0, changes: changes.map(({ tier, entry, previous, diffStat, licenseStatus }) => ({ tier, name: entry.name, before: previous ?? null, after: entry, changed: !previous || JSON.stringify(previous) !== JSON.stringify(entry), diffStat, licenseStatus, licenseAllowed: tier === "private" || permissiveLicense(entry.license) })), lint: lintReports };
    const output = [
      ...report.changes.map(change => `${change.tier}/${change.name}: ${change.before?.commit ?? "absent"} -> ${change.after.commit}\nLicence: ${change.licenseStatus} (${change.before?.license ?? "absent"} -> ${change.after.license}; ${change.licenseAllowed ? "allowed" : "blocked"})\n${change.diffStat}`),
      ...lintReports.map(formatSkillLint),
      writable ? `${report.applied ? "Applied" : "No changes"}; ${delta.length} skill lock entries changed.` : `Check only; ${delta.length} skill lock entries would change. Use --apply to install.`,
      "Skill evaluation is not run by this command; review guidance and verify outcomes before use.",
    ].join("\n");
    return { ok, output, report };
  } finally { await rm(workspace, { recursive: true, force: true }); }
}
