import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, cp, lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadKorConfig, parseDotEnv, readRuntimeEnvFile, runtimePaths } from "@kor-code/config";
import { z } from "zod";
import { checkRestore, fingerprint, mkdirRecorded, missing, readManifest, recordAfter, remember, restoreManifest, saveManifest, type InstallManifest } from "./install-journal.js";

const execFileAsync = promisify(execFile);
const PLUGIN_ID = "kor-cockpit@kor";
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
    PATH: environment.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  };
  return ["[Unit]", "Description=Kor Code Linear execution daemon", "After=network-online.target", "", "[Service]", "Type=simple",
    `WorkingDirectory=${root.replaceAll("%", "%%")}`,
    `ExecStart=${systemdQuote(process.execPath).replaceAll("$", "$$")} ${systemdQuote(join(root, "packages/cli/dist/cli.js")).replaceAll("$", "$$")} serve`,
    ...Object.entries(variables).map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`),
    "Restart=on-failure", "RestartSec=3", "NoNewPrivileges=true", "PrivateTmp=true", "", "[Install]", "WantedBy=default.target", ""].join("\n");
}

async function scaffoldConfig(pilot: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const paths = runtimePaths(environment);
  if ((await loadKorConfig(paths.configFile, { home: paths.home })).exists) return;
  let branch = "main";
  try { branch = (await command("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], environment, pilot)).replace(/^origin\//, ""); } catch {
    try { await command("git", ["rev-parse", "--verify", "refs/heads/main"], environment, pilot); }
    catch { branch = await command("git", ["symbolic-ref", "--short", "HEAD"], environment, pilot); }
  }
  // JSON is a YAML subset. Values are never shell-interpolated.
  const config = { repos: { [basename(pilot)]: { path: pilot, defaultBranch: branch, checks: [], toolAllowlist: [] } },
    limits: { total: 2, perRepository: 1 }, defaultRoute: { provider: "anthropic", model: "claude-sonnet-5-5", accountPolicy: "fill-first", sessionAffinity: true, reasoningLevel: "medium" }, pollIntervalSeconds: 60, intakeLabel: "kor" };
  await writeFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

async function scaffoldGateway(environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  const { gatewayEnvFile } = runtimePaths(environment);
  const existing = await readRuntimeEnvFile(gatewayEnvFile, { private: true });
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

async function prepareMarketplace(marketplaceDir: string): Promise<void> {
  await mkdir(join(marketplaceDir, ".claude-plugin"), { recursive: true, mode: 0o700 });
  await cp(join(root, "packages/claude-plugin"), join(marketplaceDir, "plugin"), {
    recursive: true, filter: source => !["node_modules", ".git"].includes(basename(source)),
  });
  await writeFile(join(marketplaceDir, ".claude-plugin/marketplace.json"), `${JSON.stringify({
    name: "kor", owner: { name: "Kor Code" }, metadata: { description: "Kor Code live cockpit" }, plugins: [{ name: "kor-cockpit", source: "./plugin" }],
  }, null, 2)}\n`);
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
  manifest.phase = manifest.phase === "restored" || manifest.phase === "purging" ? "purging" : "restoring";
  await saveManifest(journalPath(environment), manifest);
  await restoreManifest(manifest, purge);
  if (manifest.systemd) await command("systemctl", ["--user", "daemon-reload"], environment, root);
  manifest.phase = "restored";
  await saveManifest(journalPath(environment), manifest);
}

export async function installKor(options: { scope: InstallScope; pilot?: string; systemd: boolean }): Promise<{ output: string }> {
  const environment = process.env;
  const paths = runtimePaths(environment);
  const manifestPath = journalPath(environment);
  const old = await readManifest(manifestPath);
  if (old && old.phase !== "restored") throw new Error("An install manifest already exists; run kor uninstall before changing scope or reinstalling");
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
  const claudeEnv = { ...environment, HOME: paths.home, CLAUDE_CONFIG_DIR: configDir };
  const cliLink = join(paths.home, ".local/bin/kor");
  const serviceFile = join(dirname(paths.configDir), "systemd/user/kor.service");
  const marketplaceDir = join(paths.shareDir, "marketplace");
  const pluginCache = join(configDir, "plugins/cache/kor");
  const known = join(configDir, "plugins/known_marketplaces.json");
  const registry = join(configDir, "plugins/installed_plugins.json");
  const settings = [join(configDir, "settings.json"), known, registry];
  const metadata = [join(configDir, ".claude.json"), join(configDir, "backups")];
  const ignoreFiles = new Set<string>();
  if (options.scope === "local") {
    settings.push(join(pilot, ".claude/settings.local.json"));
    // Claude also adds settings.local.json to Git's global ignore file.
    ignoreFiles.add(join(dirname(paths.configDir), "git/ignore"));
    try {
      const configured = await command("git", ["config", "--path", "--get", "core.excludesFile"], environment, pilot);
      if (configured) ignoreFiles.add(resolve(pilot, configured));
    } catch { /* No configured excludesFile: Git uses the XDG default. */ }
    settings.push(...ignoreFiles);
  }
  const roots = [paths.configDir, paths.stateDir, paths.shareDir, dirname(manifestPath), configDir];
  for (const [index, path] of roots.entries()) {
    if (contains(path, root) || contains(path, pilot) || roots.some((other, i) => i !== index && contains(path, other))) throw new Error("Kor and Claude directories must be separate from one another and must not contain a checkout");
  }
  for (const path of [...settings, ...metadata, cliLink, serviceFile, paths.configDir, paths.stateDir, paths.shareDir, manifestPath, marketplaceDir, pluginCache]) await rejectSymlinkParents(path);
  for (const path of [...settings, ...metadata, ...roots, paths.configFile, paths.gatewayEnvFile]) {
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
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const manifest: InstallManifest = { version: 1, phase: "preparing", scope: options.scope, pilot, claudeConfigDir: configDir, systemd: options.systemd, backupDir, entries: [], createdDirectories: [] };
  // Retained roots are snapshotted before anything inside them is initialized.
  for (const path of [paths.configDir, paths.stateDir, paths.shareDir]) await remember(manifest, path, "retained");
  for (const path of [cliLink, serviceFile, ...settings, marketplaceDir, pluginCache]) await remember(manifest, path);
  for (const path of metadata) await remember(manifest, path, "runtime");
  await saveManifest(manifestPath, manifest);
  let key: string | undefined;
  try {
    for (const path of [paths.configDir, paths.stateDir, paths.shareDir, dirname(cliLink), dirname(serviceFile), configDir, join(configDir, "plugins"), join(configDir, "plugins/cache"), ...Array.from(ignoreFiles, path => dirname(path)), ...(options.scope === "local" ? [join(pilot, ".claude")] : [])]) {
      await mkdirRecorded(manifest, path);
      await saveManifest(manifestPath, manifest);
    }
    await rm(cliLink, { force: true });
    await symlink(compiledCli, cliLink);
    // Do not follow an old unit symlink when replacing it.
    await rm(serviceFile, { force: true });
    await writeFile(serviceFile, unit, { mode: 0o600 });
    await scaffoldConfig(pilot, environment);
    key = await scaffoldGateway(environment);
    await prepareMarketplace(marketplaceDir);
    await command("claude", ["plugin", "marketplace", "add", marketplaceDir, "--scope", options.scope], claudeEnv, pilot);
    await command("claude", ["plugin", "install", PLUGIN_ID, "--scope", options.scope], claudeEnv, pilot);
    const plugins = pluginListSchema.parse(JSON.parse(await command("claude", ["plugin", "list", "--json"], claudeEnv, pilot)));
    if (!plugins.some(plugin => plugin.id === PLUGIN_ID && plugin.scope === options.scope)) throw new Error("Claude did not report the installed cockpit at the requested scope");
    if (options.systemd) await command("systemctl", ["--user", "daemon-reload"], environment, root);
    await recordAfter(manifest);
    manifest.phase = "installed";
    await saveManifest(manifestPath, manifest);
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
    `Cockpit: ${PLUGIN_ID}${options.scope === "local" ? ` in ${pilot}` : ""}`, `Manifest: ${manifestPath}`,
    ...(key ? [`CLIProxyAPI addition: - ${key}`, `Stored the same new key in ${paths.gatewayEnvFile} (0600). Add the printed line to CLIProxyAPI manually.`] : ["CLIProxyAPI addition: existing credential retained; add its api-keys line manually if needed (value not printed)."]),
    "Configure repository mapping, checks and toolAllowlist; run kor doctor before starting the service.",
  ].join("\n") };
}

export async function uninstallKor(options: { purge: boolean }): Promise<{ output: string }> {
  const environment = process.env;
  const manifestPath = journalPath(environment);
  const manifest = await readManifest(manifestPath);
  if (!manifest) return { output: "Kor is not installed (no install manifest)" };
  if (manifest.phase !== "restored" || options.purge) await undo(manifest, environment, options.purge);
  if (options.purge) {
    await rm(manifestPath);
    await rm(manifest.backupDir, { recursive: true });
  }
  return { output: `Kor uninstalled${options.purge ? " (purged new Kor data; restored pre-existing data)" : "; config and state retained"}\n${options.purge ? "Replayed" : "Backups:"} ${manifest.backupDir}` };
}
