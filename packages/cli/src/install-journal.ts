import { createHash } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { registryRestoration, sameClaudeSettings, writeObject } from "./install-json.js";

const entrySchema = z.strictObject({
  path: z.string(),
  backup: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable().optional(),
  afterBackup: z.string().optional(),
  policy: z.enum(["shared", "settings", "marketplaces", "plugins", "owned", "runtime", "retained"]),
});
export const manifestSchema = z.strictObject({
  version: z.literal(1),
  phase: z.enum(["preparing", "installed", "restoring", "purging", "restored"]),
  scope: z.enum(["local", "user"]),
  pilot: z.string(),
  claudeConfigDir: z.string(),
  backupDir: z.string(),
  systemd: z.boolean(),
  entries: z.array(entrySchema),
  createdDirectories: z.array(z.string()),
});
export type InstallManifest = z.infer<typeof manifestSchema>;

export function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Includes bytes, modes, names and link targets, without following symlinks. */
export async function fingerprint(path: string): Promise<string | null> {
  const hash = createHash("sha256");
  async function visit(current: string, name: string): Promise<void> {
    const info = await lstat(current);
    hash.update(JSON.stringify([name, info.mode & 0o777]));
    if (info.isSymbolicLink()) hash.update(`link:${await readlink(current)}`);
    else if (info.isFile()) hash.update("file:").update(await readFile(current));
    else if (info.isDirectory()) {
      hash.update("directory:");
      for (const child of (await readdir(current)).sort()) await visit(join(current, child), `${name}/${child}`);
    } else throw new Error(`Unsupported install file type: ${current}`);
  }
  try { await lstat(path); } catch (error) { if (missing(error)) return null; throw error; }
  await visit(path, "");
  return hash.digest("hex");
}

export async function saveManifest(path: string, manifest: InstallManifest): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function remember(manifest: InstallManifest, path: string, policy: z.infer<typeof entrySchema>["policy"] = "shared"): Promise<void> {
  const before = await fingerprint(path);
  const backup = join(manifest.backupDir, String(manifest.entries.length));
  if (before !== null) {
    await cp(path, backup, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    const info = await lstat(path);
    if (!info.isSymbolicLink()) await chmod(backup, info.mode & 0o777);
  }
  manifest.entries.push({ path, backup, before, policy });
}

export async function mkdirRecorded(manifest: InstallManifest, path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Install directory must be a real directory: ${path}`);
  } catch (error) {
    if (!missing(error)) throw error;
    await mkdirRecorded(manifest, dirname(path));
    await mkdir(path, { mode: 0o700 });
    manifest.createdDirectories.push(path);
  }
}

export async function recordAfter(manifest: InstallManifest): Promise<void> {
  for (const entry of manifest.entries) {
    if (entry.policy === "retained") continue;
    entry.after = await fingerprint(entry.path);
    if (entry.after !== null && ["shared", "settings"].includes(entry.policy)) {
      entry.afterBackup = `${entry.backup}.after`;
      await cp(entry.path, entry.afterBackup, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    }
  }
}

/** Verify all backups and conflicts before deleting any installed file. */
export async function checkRestore(manifest: InstallManifest, purge: boolean): Promise<void> {
  for (const entry of manifest.entries) {
    if (entry.policy === "retained" && !purge) continue;
    if (entry.policy !== "retained" && ["restored", "purging"].includes(manifest.phase)) continue;
    if (entry.before !== null && await fingerprint(entry.backup) !== entry.before) throw new Error(`Missing or damaged install backup: ${entry.backup}`);
    if (entry.policy === "marketplaces" || entry.policy === "plugins") {
      // Parse before any restoration, and preserve unrelated automatic updates.
      await registryRestoration(entry.path, entry.backup, entry.policy);
    }
    if ((entry.policy === "shared" || entry.policy === "settings") && manifest.phase === "installed") {
      const current = await fingerprint(entry.path);
      if (current !== entry.after && current !== entry.before) {
        if (entry.policy === "settings" && entry.afterBackup && current !== null && await sameClaudeSettings(entry.path, entry.afterBackup)) continue;
        throw new Error(`Changed since install: ${entry.path}; save your edits, then restore ${entry.afterBackup ?? "the original path (absent before install)"} before retrying uninstall. Original: ${entry.before === null ? "absent" : entry.backup}`);
      }
    }
  }
}

export async function restoreManifest(manifest: InstallManifest, purge: boolean): Promise<void> {
  for (const entry of [...manifest.entries].reverse()) {
    if (entry.policy === "retained" && !purge) continue;
    if (entry.policy !== "retained" && manifest.phase === "purging") continue;
    const current = await fingerprint(entry.path);
    if (current === entry.before) continue;
    if (entry.policy === "marketplaces" || entry.policy === "plugins") {
      const restored = await registryRestoration(entry.path, entry.backup, entry.policy);
      if (!restored.original) { await writeObject(entry.path, restored.value); continue; }
    }
    // Session metadata is not plugin configuration. Keep later sessions' state.
    if (entry.policy === "runtime" && entry.after !== undefined && current !== entry.after) continue;
    await rm(entry.path, { recursive: true, force: true });
    if (entry.before !== null) {
      await mkdir(dirname(entry.path), { recursive: true, mode: 0o700 });
      const info = await lstat(entry.backup);
      if (info.isSymbolicLink()) await symlink(await readlink(entry.backup), entry.path);
      else {
        await cp(entry.backup, entry.path, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
        await chmod(entry.path, info.mode & 0o777);
      }
    }
  }
  await pruneDirectories(manifest);
}

/** Also called after removing the journal on purge. Never remove other contents. */
export async function pruneDirectories(manifest: InstallManifest): Promise<void> {
  for (const path of [...manifest.createdDirectories].reverse()) {
    await rmdir(path).catch(error => {
      if (missing(error) || error instanceof Error && "code" in error && error.code === "ENOTEMPTY") return;
      throw error;
    });
  }
}

export async function readManifest(path: string): Promise<InstallManifest | undefined> {
  let source: string;
  try { source = await readFile(path, "utf8"); } catch (error) { if (missing(error)) return undefined; throw error; }
  const parsed: unknown = JSON.parse(source);
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) throw new Error("Invalid install manifest; recover it from the install backup directory");
  return result.data;
}
