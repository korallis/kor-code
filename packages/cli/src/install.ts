import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadKorConfig, parseDotEnv, readRuntimeEnvFile, runtimePaths } from "@kor-code/config";
import { z } from "zod";
import { stringify } from "yaml";
import { checkRestore, fingerprint, mkdirRecorded, missing, pruneDirectories, readManifest, recordAfter, remember, restoreManifest, saveManifest, type InstallManifest } from "./install-journal.js";

import { uninstallSkills } from "./skills-install.js";
import { stopLocalDaemon } from "./daemon-lifecycle.js";

import { addKorSettings, installedPluginSchema, PLUGIN_ID, readObject, writeObject } from "./install-json.js";

const execFileAsync = promisify(execFile);
const pluginListSchema = z.array(z.object({ id: z.string(), scope: z.string(), installPath: z.string() }));
export type InstallScope = "local" | "user";
const root = fileURLToPath(new URL("../../..", import.meta.url));

async function command(file: string, args: string[], environment: NodeJS.ProcessEnv, cwd: string): Promise<string> {
  try {
    return (await execFileAsync(file, args, { env: environment, cwd, timeout: 30_000, maxBuffer: 512 * 1024 })).stdout.trim();
  } catch {
    // Upstream stderr may contain settings or credentials. Name only the operation.
    throw new Error(`${file} ${args.slice(0, file === "claude" ? 3 : 2).join(" ")} failed`);
  }
}

async function exists(path: string): Promise<boolean> { return await fingerprint(path) !== null; }

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || path !== ".." && !path.startsWith("../") && !path.startsWith("/");
}

async function rejectSymlinkParents(path: string): Promise<void> {
  let current = dirname(path);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Install path has a symlink parent: ${current}`); }
    catch (error) { if (!missing(error)) throw error; }
    const parent = dirname(current);
    if (current === parent) break;
    current = parent;
  }
}

function systemdQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Install paths and environment cannot contain newlines or NUL");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
}

function unitFile(environment: NodeJS.ProcessEnv): string {
  const paths = runtimePaths(environment);
  const variables = {
    HOME: paths.home,
    XDG_CONFIG_HOME: dirname(paths.configDir),
    XDG_STATE_HOME: dirname(paths.stateDir),
    XDG_DATA_HOME: dirname(paths.shareDir),
    PATH: [...new Set([join(paths.home, ".local/bin"), join(paths.home, ".npm-global/bin"), dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"])].join(":"),
  };
  return ["[Unit]", "Description=Kor Code Linear execution daemon", "After=network-online.target", "", "[Service]", "Type=simple",
    `WorkingDirectory=${root.replaceAll("%", "%%")}`,
    `ExecStart=${systemdQuote(process.execPath).replaceAll("$", "$$")} ${systemdQuote(join(root, "packages/cli/dist/cli.js")).replaceAll("$", "$$")} serve`,
    ...Object.entries(variables).map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`),
    "Restart=on-failure", "RestartSec=3", "NoNewPrivileges=true", "PrivateTmp=true", "", "[Install]", "WantedBy=default.target", ""].join("\n");
}

async function scaffoldConfig(pilot: string, environment: NodeJS.ProcessEnv, linearTeam: string | undefined): Promise<void> {
  const paths = runtimePaths(environment);
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  if (loaded.exists) return;
  let branch = "main";
  try { branch = (await command("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], environment, pilot)).replace(/^origin\//, ""); } catch {
    try { await command("git", ["rev-parse", "--verify", "refs/heads/main"], environment, pilot); }
    catch { branch = await command("git", ["symbolic-ref", "--short", "HEAD"], environment, pilot); }
  }
  const { limits, launchProfile, pollIntervalSeconds, intakeLabel } = loaded.config;
  const config = { repos: { [basename(pilot)]: { path: pilot, linearTeam: linearTeam ?? "YOUR_TEAM_KEY", defaultBranch: branch, ship: "auto", checks: [], toolAllowlist: [] } },
    limits, launchProfile, pollIntervalSeconds, intakeLabel };
  await writeFile(paths.configFile, stringify(config), { mode: 0o600 });
}

async function scaffoldGateway(environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  const { gatewayEnvFile } = runtimePaths(environment);
  const existing = await readRuntimeEnvFile(gatewayEnvFile, { private: true });
  const baseUrl = environment.KOR_GATEWAY_URL || environment.CPA_BASE_URL;
  if (baseUrl && baseUrl !== (existing.KOR_GATEWAY_URL || existing.CPA_BASE_URL)) {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("KOR_GATEWAY_URL must be an HTTP(S) URL without credentials, query or fragment");
    const previous = await readFile(gatewayEnvFile, "utf8").catch(error => { if (missing(error)) return ""; throw error; });
    await writeFile(gatewayEnvFile, `${previous}${previous.endsWith("\n") || !previous ? "" : "\n"}KOR_GATEWAY_URL=${JSON.stringify(baseUrl)}\n`, { mode: 0o600 });
  }
  if (existing.KOR_GATEWAY_KEY || existing.CPA_API_KEY) return undefined;
  if (environment.KOR_GATEWAY_KEY || environment.CPA_API_KEY || environment.KOR_GATEWAY_KEY_FILE) {
    if (!await exists(gatewayEnvFile)) await writeFile(gatewayEnvFile, "# Supply KOR_GATEWAY_KEY at runtime or add it here (mode 0600).\n", { mode: 0o600 });
    return undefined;
  }
  const key = `kor-${randomBytes(24).toString("base64url")}`;
  const previous = await readFile(gatewayEnvFile, "utf8").catch(error => { if (missing(error)) return ""; throw error; });
  // Validate assignments without evaluating them; retain any existing URL/comments.
  parseDotEnv(previous);
  await writeFile(gatewayEnvFile, `${previous}${previous.endsWith("\n") || !previous ? "" : "\n"}KOR_GATEWAY_KEY=${key}\n`, { mode: 0o600 });
  return key;
}

async function prepareMarketplace(marketplaceDir: string, pilot: string | undefined): Promise<void> {
  await mkdir(join(marketplaceDir, ".claude-plugin"), { recursive: true, mode: 0o700 });
  await cp(join(root, "packages/claude-plugin"), join(marketplaceDir, "plugin"), {
    recursive: true, filter: source => !["node_modules", ".git"].includes(basename(source)),
  });
  await writeFile(join(marketplaceDir, "plugin/hooks/install-scope.ts"), `export const installationPilot: string | undefined = ${pilot === undefined ? "undefined" : JSON.stringify(pilot)};\n`);
  await writeFile(join(marketplaceDir, ".claude-plugin/marketplace.json"), `${JSON.stringify({
    name: "kor", owner: { name: "Kor Code" }, metadata: { description: "Kor Code live cockpit" }, plugins: [{ name: "kor-cockpit", source: "./plugin" }],
  }, null, 2)}\n`);
}

/** Claude's plugin CLI can migrate unrelated settings. Run it only in staging. */
async function installCockpit(manifest: InstallManifest, marketplaceDir: string, stage: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const stagedConfig = join(stage, ".claude");
  const stagedPilot = join(stage, "pilot");
  await mkdir(stagedPilot, { recursive: true, mode: 0o700 });
  const isolated = { HOME: stage, CLAUDE_CONFIG_DIR: stagedConfig, XDG_CONFIG_HOME: join(stage, ".config"),
    XDG_STATE_HOME: join(stage, ".local/state"), XDG_DATA_HOME: join(stage, ".local/share"),
    PATH: environment.PATH, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" };
  await command("git", ["init", "-q", stagedPilot], isolated, stage);
  await command("claude", ["plugin", "marketplace", "add", marketplaceDir, "--scope", manifest.scope], isolated, stagedPilot);
  await command("claude", ["plugin", "install", PLUGIN_ID, "--scope", manifest.scope], isolated, stagedPilot);
  const plugins = pluginListSchema.parse(JSON.parse(await command("claude", ["plugin", "list", "--json"], isolated, stagedPilot)));
  if (!plugins.some(plugin => plugin.id === PLUGIN_ID && plugin.scope === manifest.scope)) throw new Error("Claude did not report the installed cockpit at the requested scope");
  const known = join(manifest.claudeConfigDir, "plugins/known_marketplaces.json");
  const registry = join(manifest.claudeConfigDir, "plugins/installed_plugins.json");
  const stagedKnown = await readObject(join(stagedConfig, "plugins/known_marketplaces.json"));
  const stagedPlugins = z.object({ plugins: z.record(z.string(), z.array(installedPluginSchema)) }).parse(await readObject(join(stagedConfig, "plugins/installed_plugins.json")));
  const entries = stagedPlugins.plugins[PLUGIN_ID];
  if (!stagedKnown.kor || !entries?.length) throw new Error("Claude did not prepare the Kor registry entries");
  const installed = entries.map(entry => {
    if (!contains(join(stagedConfig, "plugins/cache/kor"), entry.installPath)) throw new Error("Claude returned an unexpected cache path");
    return { ...entry, installPath: join(manifest.claudeConfigDir, relative(stagedConfig, entry.installPath)), ...(manifest.scope === "local" ? { projectPath: manifest.pilot } : {}) };
  });
  await cp(join(stagedConfig, "plugins/cache/kor"), join(manifest.claudeConfigDir, "plugins/cache/kor"), { recursive: true });
  const existing = z.looseObject({ version: z.literal(2).optional(), plugins: z.record(z.string(), z.unknown()).optional() }).parse(await readObject(registry));
  await writeObject(known, { ...await readObject(known), kor: stagedKnown.kor });
  await writeObject(registry, { ...existing, version: 2, plugins: { ...existing.plugins, [PLUGIN_ID]: installed } });
  const settings = manifest.scope === "local" ? join(manifest.pilot, ".claude/settings.local.json") : join(manifest.claudeConfigDir, "settings.json");
  const stagedSettings = manifest.scope === "local" ? join(stagedPilot, ".claude/settings.local.json") : join(stagedConfig, "settings.json");
  await addKorSettings(settings, stagedSettings);
}

function journalPath(environment: NodeJS.ProcessEnv): string { return `${runtimePaths(environment).stateDir}-install/manifest.json`; }

async function serviceInUse(environment: NodeJS.ProcessEnv): Promise<boolean> {
  for (const option of ["is-active", "is-enabled"]) {
    try { await execFileAsync("systemctl", ["--user", option, "--quiet", "kor.service"], { env: environment, timeout: 10_000 }); return true; }
    catch (error) {
      if (!(error instanceof Error && "code" in error && typeof error.code === "number")) throw new Error("Cannot check the Kor user service");
    }
  }
  return false;
}

async function undo(manifest: InstallManifest, environment: NodeJS.ProcessEnv, purge: boolean): Promise<void> {
  await checkRestore(manifest, purge);
  if (manifest.systemd && manifest.phase !== "restored") {
    await command("systemctl", ["--user", "stop", "kor.service"], environment, root);
    await command("systemctl", ["--user", "disable", "kor.service"], environment, root);
  }
  await stopLocalDaemon();
  manifest.phase = manifest.phase === "restored" || manifest.phase === "purging" ? "purging" : "restoring";
  await saveManifest(journalPath(environment), manifest);
  await restoreManifest(manifest, purge);
  if (manifest.systemd) await command("systemctl", ["--user", "daemon-reload"], environment, root);
  manifest.phase = "restored";
  await saveManifest(journalPath(environment), manifest);
}

/** Refresh installed artifacts while keeping the original uninstall journal and credentials. */
async function refreshKor(manifest: InstallManifest, options: { scope: InstallScope; pilot?: string; linearTeam?: string; systemd: boolean }): Promise<{ output: string }> {
  const paths = runtimePaths();
  if (manifest.scope !== options.scope || manifest.claudeConfigDir !== resolve(process.env.CLAUDE_CONFIG_DIR || join(paths.home, ".claude")) || options.pilot && await realpath(resolve(options.pilot.replace(/^~\//, `${paths.home}/`))) !== manifest.pilot) {
    throw new Error("Installation scope, Claude directory or pilot changed; uninstall before changing these options");
  }
  if (await realpath(join(paths.home, ".local/bin/kor")) !== join(root, "packages/cli/dist/cli.js")) throw new Error("Kor is installed from another checkout; rerun its installer instead");
  await chmod(join(root, "packages/cli/dist/cli.js"), 0o755);
  await checkRestore(manifest, false);
  if (manifest.systemd) await command("systemctl", ["--user", "stop", "kor.service"], process.env, root);
  await stopLocalDaemon();
  const refreshDir = join(manifest.backupDir, "refresh");
  if (await exists(refreshDir)) throw new Error(`Interrupted update backup at ${refreshDir}; recover it before retrying`);
  const rollback: InstallManifest = { ...manifest, backupDir: join(refreshDir, "rollback"), phase: "preparing", entries: [], createdDirectories: [] };
  await mkdir(rollback.backupDir, { recursive: true, mode: 0o700 });
  const marketplace = join(paths.shareDir, "marketplace");
  const stage = join(refreshDir, "staging");
  try {
    for (const entry of manifest.entries) {
      if (entry.policy !== "retained" && !contains(manifest.backupDir, entry.path)) {
        await rejectSymlinkParents(entry.path);
        await remember(rollback, entry.path, "owned");
      }
    }
    await saveManifest(join(refreshDir, "manifest.json"), rollback);
    await rm(marketplace, { recursive: true, force: true });
    await rm(join(manifest.claudeConfigDir, "plugins/cache/kor"), { recursive: true, force: true });
    await prepareMarketplace(marketplace, manifest.scope === "local" ? manifest.pilot : undefined);
    await installCockpit(manifest, marketplace, stage, process.env);
    await recordAfter(manifest);
    await saveManifest(journalPath(process.env), manifest);
  } catch (error) {
    try { await restoreManifest(rollback, true); }
    catch { throw new Error(`Update failed; rollback backup retained at ${refreshDir}`); }
    await rm(refreshDir, { recursive: true, force: true });
    throw error;
  }
  await rm(refreshDir, { recursive: true, force: true });
  return { output: "Kor updated; configuration, credentials and original uninstall backups retained.\nDaemon stopped for the update; run kor ui to launch Mission Control.\nCLIProxyAPI addition: existing credential retained (value not printed)." };
}

export async function installKor(options: { scope: InstallScope; pilot?: string; linearTeam?: string; systemd: boolean }): Promise<{ output: string }> {
  const environment = process.env;
  const paths = runtimePaths(environment);
  const manifestPath = journalPath(environment);
  const old = await readManifest(manifestPath);
  if (old?.phase === "installed") return refreshKor(old, options);
  if (old && old.phase !== "restored") throw new Error("An incomplete install manifest exists; run kor uninstall before reinstalling");
  if (options.scope === "local" && !options.pilot) throw new Error("--pilot is required for a local install");
  const pilot = await realpath(resolve(options.pilot?.replace(/^~\//, `${paths.home}/`) ?? root));
  const gitRoot = await command("git", ["rev-parse", "--show-toplevel"], environment, pilot);
  if (await realpath(gitRoot) !== pilot) throw new Error("--pilot must name a Git checkout root");
  if (options.scope === "local") {
    const gitDir = await command("git", ["rev-parse", "--absolute-git-dir"], environment, pilot);
    const commonDir = await command("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], environment, pilot);
    if (await realpath(gitDir) !== await realpath(commonDir)) {
      throw new Error("Local cockpit installation requires a standalone checkout; Claude writes linked-worktree settings into its primary checkout. Use a normal clone for --pilot");
    }
  }
  const configDir = resolve(environment.CLAUDE_CONFIG_DIR || join(paths.home, ".claude"));
  const cliLink = join(paths.home, ".local/bin/kor");
  const serviceFile = join(dirname(paths.configDir), "systemd/user/kor.service");
  const marketplaceDir = join(paths.shareDir, "marketplace");
  const pluginCache = join(configDir, "plugins/cache/kor");
  const known = join(configDir, "plugins/known_marketplaces.json");
  const registry = join(configDir, "plugins/installed_plugins.json");
  const settings = [join(configDir, "settings.json")];
  const exclude = options.scope === "local" ? join(pilot, ".git/info/exclude") : undefined;
  if (options.scope === "local") settings.push(join(pilot, ".claude/settings.local.json"));
  const roots = [paths.configDir, paths.stateDir, paths.shareDir, dirname(manifestPath), configDir];
  for (const [index, path] of roots.entries()) {
    if (contains(path, root) || contains(path, pilot) || roots.some((other, i) => i !== index && contains(path, other))) throw new Error("Kor and Claude directories must be separate from one another and must not contain a checkout");
  }
  for (const path of [...settings, known, registry, ...(exclude ? [exclude] : []), cliLink, serviceFile, paths.configDir, paths.stateDir, paths.shareDir, manifestPath, marketplaceDir, pluginCache]) await rejectSymlinkParents(path);
  for (const path of [...settings, known, registry, ...(exclude ? [exclude] : []), ...roots, paths.configFile, paths.gatewayEnvFile]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Install destination must not be a symlink: ${path}`); }
    catch (error) { if (!missing(error)) throw error; }
  }
  for (const path of [marketplaceDir, pluginCache]) if (await exists(path)) throw new Error(`Install destination already exists: ${path}`);
  for (const path of [known, registry]) {
    const value: unknown = JSON.parse(await readFile(path, "utf8").catch(error => { if (missing(error)) return "{}"; throw error; }));
    const record = z.record(z.string(), z.unknown()).parse(value);
    if (path === known && "kor" in record || path === registry && JSON.stringify(record.plugins ?? {}).includes(PLUGIN_ID)) throw new Error("Kor is already registered with Claude; remove that installation first");
  }
  await loadKorConfig(paths.configFile, { home: paths.home });
  await readRuntimeEnvFile(paths.gatewayEnvFile, { private: true });
  const compiledCli = join(root, "packages/cli/dist/cli.js");
  if (!await exists(compiledCli)) throw new Error("Build the workspace with pnpm build before installing");
  await chmod(compiledCli, 0o755);
  const unit = unitFile(environment);
  if (options.systemd) {
    await command("systemctl", ["--user", "show-environment"], environment, root);
    if (await serviceInUse(environment)) throw new Error("kor.service is already active or enabled; uninstall its current installation first");
  }
  const backupDir = join(dirname(manifestPath), "backups", `${Date.now()}-${randomBytes(4).toString("hex")}`);
  const manifest: InstallManifest = { version: 1, phase: "preparing", scope: options.scope, pilot, claudeConfigDir: configDir, systemd: options.systemd, backupDir, entries: [], createdDirectories: old?.createdDirectories ?? [] };
  await mkdirRecorded(manifest, backupDir);
  // Retained roots are snapshotted before anything inside them is initialized.
  for (const path of [paths.configDir, paths.stateDir, paths.shareDir]) await remember(manifest, path, "retained");
  for (const path of [cliLink, serviceFile, ...(exclude ? [exclude] : [])]) await remember(manifest, path);
  for (const path of settings) await remember(manifest, path, "settings");
  for (const path of [marketplaceDir, pluginCache]) await remember(manifest, path, "owned");
  await remember(manifest, known, "marketplaces");
  await remember(manifest, registry, "plugins");
  const stage = join(backupDir, "staging");
  await remember(manifest, stage, "owned");
  await saveManifest(manifestPath, manifest);
  let key: string | undefined;
  try {
    for (const path of [paths.configDir, paths.stateDir, paths.shareDir, dirname(cliLink), dirname(serviceFile), configDir, join(configDir, "plugins"), join(configDir, "plugins/cache"), join(configDir, "plugins/marketplaces"), ...(options.scope === "local" ? [join(pilot, ".claude")] : [])]) {
      await mkdirRecorded(manifest, path);
      await saveManifest(manifestPath, manifest);
    }
    await rm(cliLink, { force: true });
    await symlink(compiledCli, cliLink);
    // Do not follow an old unit symlink when replacing it.
    await rm(serviceFile, { force: true });
    await writeFile(serviceFile, unit, { mode: 0o600 });
    await scaffoldConfig(pilot, environment, options.linearTeam);
    key = await scaffoldGateway(environment);
    await prepareMarketplace(marketplaceDir, options.scope === "local" ? pilot : undefined);
    await installCockpit(manifest, marketplaceDir, stage, environment);
    if (exclude) {
      const previous = await readFile(exclude, "utf8").catch(error => { if (missing(error)) return ""; throw error; });
      if (!previous.split(/\r?\n/).includes("/.claude/settings.local.json")) {
        await writeFile(exclude, `${previous}${previous.endsWith("\n") || !previous ? "" : "\n"}/.claude/settings.local.json\n`);
      }
    }
    await rm(stage, { recursive: true, force: true });
    if (options.systemd) await command("systemctl", ["--user", "daemon-reload"], environment, root);
    await recordAfter(manifest);
    manifest.phase = "installed";
    await saveManifest(manifestPath, manifest);
    if (old) await rm(old.backupDir, { recursive: true, force: true });
  } catch (error) {
    // Preserve the journal if rollback fails so a subsequent uninstall can resume.
    try {
      await checkRestore(manifest, true);
      manifest.phase = "restoring";
      await saveManifest(manifestPath, manifest);
      await restoreManifest(manifest, true);
      if (options.systemd) await command("systemctl", ["--user", "daemon-reload"], environment, root);
      manifest.phase = "restored";
      await saveManifest(manifestPath, manifest);
    } catch { throw new Error(`Install failed; recovery manifest retained at ${manifestPath}. Run kor uninstall --purge to restore backups`); }
    throw error;
  }
  return { output: [
    `Kor installed (scope: ${options.scope})`, `CLI: ${cliLink}`, `Config: ${paths.configFile}`, `Service: ${serviceFile} (not started${options.systemd ? "" : "; systemd control skipped"})`,
    `Cockpit: ${PLUGIN_ID}${options.scope === "local" ? ` only when Claude starts in ${pilot} (linked worktrees disabled)` : ""}`, `Manifest: ${manifestPath}`,
    ...(key ? [`CLIProxyAPI addition: - ${key}`, `Stored the same new key in ${paths.gatewayEnvFile} (0600). Add the printed line to CLIProxyAPI manually.`] : ["CLIProxyAPI addition: existing credential retained; add its api-keys line manually if needed (value not printed)."]),
    "Confirm linearTeam (replace YOUR_TEAM_KEY if present), checks and toolAllowlist; run kor doctor before starting the service.",
  ].join("\n") };
}

export async function uninstallKor(options: { purge: boolean }): Promise<{ output: string }> {
  const environment = process.env;
  const manifestPath = journalPath(environment);
  const manifest = await readManifest(manifestPath);
  let output = "Kor is not installed (no install manifest)";
  if (manifest) {
    if (manifest.phase !== "restored" || options.purge) await undo(manifest, environment, options.purge);
    if (options.purge) {
      await rm(manifestPath);
      await rm(`${manifestPath}.tmp`, { force: true });
      await rm(manifest.backupDir, { recursive: true });
      await pruneDirectories(manifest);
    }
    output = `Kor uninstalled${options.purge ? " (purged new Kor data; restored pre-existing data)" : "; config and state retained"}\n${options.purge ? "Replayed" : "Backups:"} ${manifest.backupDir}`;
  }
  if (options.purge) {
    const paths = runtimePaths(environment);
    const cache = resolve(environment.XDG_CACHE_HOME || join(paths.home, ".cache"), "kor-code");
    if ([root, paths.configDir, paths.stateDir, paths.shareDir, manifest?.pilot].some(path => path && (contains(cache, path) || contains(path, cache)))) throw new Error("Installer cache must be separate from Kor data and checkouts");
    await rejectSymlinkParents(cache);
    if (await exists(cache) && (await lstat(cache)).isSymbolicLink()) throw new Error("Installer cache must not be a symlink");
    await rm(cache, { recursive: true, force: true });
  }
  const skillsOutput = await uninstallSkills(options).catch(error =>
    `WARNING: Imported skills recovery is incomplete: ${error instanceof Error ? error.message : "unable to restore skills"}. Kor's own uninstall completed; skills backups were retained.`,
  );
  return { output: [output, skillsOutput].filter(Boolean).join("\n") };
}
