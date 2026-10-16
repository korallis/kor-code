import { z } from "zod";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadGatewayEnvironment, loadKorConfig, parseDotEnv, runtimePaths, type GatewayEnvironment, type KorPaths, type KorRepositoryConfig } from "@kor-code/config";
import { MissionServices } from "@kor-code/daemon";
import { sessionPermissions, sessionTools } from "@kor-code/controller";
import { readModelRegistry } from "@kor-code/gateway-adapter";

const execFileAsync = promisify(execFile);

export type DoctorStatus = "ok" | "error";
export interface DoctorCheck { name: string; status: DoctorStatus; detail: string }
export interface DoctorReport { checks: DoctorCheck[]; ok: boolean }
export interface DoctorOptions {
  environment?: NodeJS.ProcessEnv;
  paths?: KorPaths;
  fetcher?: typeof globalThis.fetch;
  command?: DoctorCommand;
}

export type DoctorCommand = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

function commandRunner(environment: NodeJS.ProcessEnv): DoctorCommand {
  return async (file, args) => {
    if (!file) throw new Error("command name is empty");
    return execFileAsync(file, [...args], { env: environment, timeout: 20_000, maxBuffer: 256 * 1024 });
  };
}

async function credentialFromFile(path: string, names: readonly string[]): Promise<boolean> {
  try {
    const values = parseDotEnv(await readFile(path, "utf8"));
    return names.some(name => Boolean(values[name]));
  } catch { return false; }
}

async function checkCredential(label: string, names: readonly string[], file: string, environment: NodeJS.ProcessEnv): Promise<DoctorCheck> {
  if (names.some(name => environment[name]?.trim()) || await credentialFromFile(file, names)) return { name: label, status: "ok", detail: "available" };
  return { name: label, status: "error", detail: "missing" };
}

async function checkGateway(environment: NodeJS.ProcessEnv, paths: KorPaths, fetcher: typeof globalThis.fetch): Promise<DoctorCheck> {
  let gateway: GatewayEnvironment;
  try { gateway = await loadGatewayEnvironment(paths.gatewayEnvFile, environment); }
  catch (error) { return { name: "CLIProxyAPI with Kor key", status: "error", detail: error instanceof Error ? error.message : "runtime environment unavailable" }; }
  if (!gateway.key) {
    const suggestedKey = `kor-${randomBytes(24).toString("base64url")}`;
    return { name: "CLIProxyAPI with Kor key", status: "error", detail: `missing; CLIProxyAPI addition: - ${suggestedKey}` };
  }
  const baseUrl = gateway.baseUrl ?? "http://127.0.0.1:8317";
  try {
    const response = await fetcher(`${baseUrl.replace(/\/$/, "")}/v1/models`, { headers: { authorization: `Bearer ${gateway.key}` }, signal: AbortSignal.timeout(5_000) });
    await response.body?.cancel();
    if (!response.ok) return { name: "CLIProxyAPI with Kor key", status: "error", detail: `HTTP ${response.status}` };
    return { name: "CLIProxyAPI with Kor key", status: "ok", detail: "reachable" };
  } catch { return { name: "CLIProxyAPI with Kor key", status: "error", detail: "unreachable" }; }
}

async function checkManagement(environment: NodeJS.ProcessEnv, paths: KorPaths, fetcher: typeof globalThis.fetch): Promise<DoctorCheck> {
  let gateway: GatewayEnvironment;
  try { gateway = await loadGatewayEnvironment(paths.gatewayEnvFile, environment); }
  catch (error) { return { name: "CLIProxyAPI management access", status: "error", detail: error instanceof Error ? error.message : "runtime environment unavailable" }; }
  const managementKey = gateway.managementKey;
  if (!managementKey) return { name: "CLIProxyAPI management access", status: "error", detail: "management key missing" };
  const baseUrl = gateway.baseUrl ?? "http://127.0.0.1:8317";
  const url = gateway.managementUrl ?? `${baseUrl.replace(/\/$/, "")}/v0/management/config`;
  try {
    const response = await fetcher(url, { headers: { authorization: `Bearer ${managementKey}` }, signal: AbortSignal.timeout(5_000) });
    await response.body?.cancel();
    return response.ok ? { name: "CLIProxyAPI management access", status: "ok", detail: "available" } : { name: "CLIProxyAPI management access", status: "error", detail: `HTTP ${response.status}` };
  } catch { return { name: "CLIProxyAPI management access", status: "error", detail: "unreachable" }; }
}

async function checkCommand(name: string, file: string, args: readonly string[], command: DoctorCommand): Promise<DoctorCheck> {
  try {
    const result = await command(file, args);
    if (name === "Claude Code") {
      const version = /^(\d+\.\d+\.\d+)(?: \(Claude Code\))?$/.exec(result.stdout.trim())?.[1];
      return version ? { name, status: "ok", detail: `${version} (Claude Code)` } : { name, status: "error", detail: "unrecognized version output" };
    }
    if (name === "no-mistakes daemon" && !/daemon running\b/.test(result.stdout)) return { name, status: "error", detail: "not running" };
    return { name, status: "ok", detail: "available" };
  } catch { return { name, status: "error", detail: "unavailable" }; }
}

async function checkShipping(key: string, repository: KorRepositoryConfig, command: DoctorCommand, mission: MissionServices, environment: NodeJS.ProcessEnv): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const git = async (args: string[]) => (await command("git", ["-C", repository.path, ...args])).stdout.trim();
  const remote = repository.remote ?? await git(["remote", "get-url", "origin"]).catch(() => undefined);
  const slug = remote && /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];
  checks.push({ name: `repo ${key} shipping target`, status: slug ? "ok" : "error", detail: slug ? "github.com" : "Shipping needs a github.com repository. Set origin with `git remote set-url origin https://github.com/OWNER/REPO.git` (use `git remote add origin` if missing), or set this repo's remote in config.yaml." });
  const missingIdentity: string[] = [];
  for (const field of ["user.name", "user.email"]) {
    try { if (!await git(["config", "--get", field])) missingIdentity.push(field); }
    catch { missingIdentity.push(field); }
  }
  checks.push({ name: `repo ${key} git identity`, status: missingIdentity.length ? "error" : "ok", detail: missingIdentity.length ? `Missing ${missingIdentity.join(" and ")}. In this repository run ${missingIdentity.map(field => `\`git config ${field} "${field === "user.name" ? "Your Name" : "you@example.com"}"\``).join(" and ")}.` : "user.name and user.email configured" });
  if (slug && remote) {
    try {
      const result = await mission.github(`/repos/${slug}`, undefined, environment);
      const access = z.object({ permissions: z.object({ push: z.literal(true) }) }).safeParse(result);
      if (!access.success) throw new Error("No repository write access");
      checks.push({ name: `repo ${key} GitHub API`, status: "ok", detail: "authenticated with repository write access; PR publication uses the API" });
    } catch {
      checks.push({ name: `repo ${key} GitHub API`, status: "error", detail: "Run gh auth login --hostname github.com, set GH_TOKEN or GITHUB_TOKEN with repository write and pull request access, or save a token in Settings. gh-axi is optional." });
    }
    try {
      const probeRef = `HEAD:refs/heads/kor/doctor-${randomBytes(8).toString("hex")}`;
      await git(["push", "--dry-run", "--no-verify", "--porcelain", remote, probeRef]);
      checks.push({ name: `repo ${key} push access`, status: "ok", detail: "push dry run passed; no remote refs changed" });
    } catch {
      checks.push({ name: `repo ${key} push access`, status: "error", detail: "Push dry run failed. Run `gh auth login --hostname github.com`, set GH_TOKEN or GITHUB_TOKEN with repository write access, or save a token in Settings. For SSH origins, configure a GitHub SSH key. Check repository access and network, then rerun `kor doctor`." });
    }
  } else {
    checks.push({ name: `repo ${key} push access`, status: "error", detail: "Not checked; fix the shipping target above and rerun `kor doctor`." });
  }
  return checks;
}

async function checkRepositories(config: Awaited<ReturnType<typeof loadKorConfig>>, command: DoctorCommand, mission: MissionServices, environment: NodeJS.ProcessEnv): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const [key, repository] of Object.entries(config.config.repos).sort(([left], [right]) => left.localeCompare(right))) {
    let detail = "path is unavailable";
    try {
      await access(repository.path);
      detail = "path is not a Git checkout root";
      const root = (await command("git", ["-C", repository.path, "rev-parse", "--show-toplevel"])).stdout.trim();
      if (await realpath(repository.path) !== await realpath(root)) throw new Error();
      detail = "configured default branch is missing";
      await command("git", ["-C", repository.path, "rev-parse", "--verify", `refs/heads/${repository.defaultBranch}^{commit}`]).catch(() =>
        command("git", ["-C", repository.path, "rev-parse", "--verify", `refs/remotes/origin/${repository.defaultBranch}^{commit}`]));
      if (repository.remote) {
        detail = "origin does not match configured remote";
        const remote = (await command("git", ["-C", repository.path, "remote", "get-url", "origin"])).stdout.trim();
        if (remote !== repository.remote) throw new Error();
      }
      const permissions = await sessionPermissions({ worktree: repository.path, allowedTools: repository.toolAllowlist, checks: repository.checks, ...(repository.tools ? { tools: repository.tools } : {}) });
      const permitted = sessionTools(permissions);
      const tools = sessionTools(permissions, repository.tools).filter(tool => permitted.includes(tool));
      checks.push({ name: `repo ${key}`, status: "ok", detail: `${repository.path} (${repository.defaultBranch})` });
      checks.push(...await checkShipping(key, repository, command, mission, environment));
      checks.push({ name: `repo ${key} tools`, status: "ok", detail: `${tools.join(", ") || "none"} (${repository.tools ? "tools override intersected with policy" : "effective permission base names; automatic search requires unscoped Read"}); Jev selects optional tools per task; availability does not grant command permissions` });
    } catch {
      // Never forward git stderr: a configured remote can contain credentials.
      checks.push({ name: `repo ${key}`, status: "error", detail });
    }
  }
  return checks;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const environment = options.environment ?? process.env;
  const paths = options.paths ?? runtimePaths(environment);
  const mission = new MissionServices(paths);
  const connectionsFile = join(paths.stateDir, "connections.json");
  let connections: DoctorCheck | undefined;
  // A corrupt file leaves saved connections empty; the remaining checks then use the environment.
  try { await mission.initialize(); }
  catch { connections = { name: "Saved connections", status: "error", detail: `${connectionsFile} is corrupt or unreadable, so the daemon will not start. Move it aside with \`mv ${connectionsFile} ${connectionsFile}.bad\`, reconnect in Mission Control Settings, then rerun \`kor doctor\`.` }; }
  const command: DoctorCommand = options.command ?? commandRunner(mission.shippingEnvironment(environment));
  let jevKey: DoctorCheck;
  try {
    const available = Boolean(await mission.jevApiKey(environment));
    jevKey = { name: "TypeSafe key", status: available ? "ok" : "error", detail: available ? "available" : "missing; set TYPESAFE_API_KEY or ~/.config/typesafe/env" };
  } catch { jevKey = { name: "TypeSafe key", status: "error", detail: "Unable to read TypeSafe runtime credential file" }; }
  let config: Awaited<ReturnType<typeof loadKorConfig>> | undefined;
  let configCheck: DoctorCheck;
  try {
    config = await loadKorConfig(paths.configFile, { home: paths.home });
    configCheck = { name: "Kor config", status: config.exists ? "ok" : "error", detail: config.exists ? paths.configFile : `missing (${paths.configFile})` };
  } catch { configCheck = { name: "Kor config", status: "error", detail: "invalid or unreadable; see docs/configuration.md" }; }
  const checks: DoctorCheck[] = [
    configCheck,
    ...(connections ? [connections] : []),
    ...(config && !Object.values(config.config.repos).some(repo => repo.tracker === "linear") ? [] : [await checkCredential("Linear key", ["LINEAR_API_KEY"], resolve(paths.home, ".config", "linear", "env"), environment)]),
    jevKey,
    await checkGateway(environment, paths, options.fetcher ?? globalThis.fetch),
    await checkManagement(environment, paths, options.fetcher ?? globalThis.fetch),
    await checkCommand("quota-axi", "quota-axi", ["--json", "--no-credential-refresh"], command),
    await checkCommand("Claude Code", "claude", ["--version"], command),
    ...(config && Object.values(config.config.repos).some(repository => repository.ship !== "merge")
      ? [await checkCommand("no-mistakes daemon", "no-mistakes", ["daemon", "status"], command)] : []),
  ];
  try {
    const verified = (await readModelRegistry(paths.modelsFile)).models.filter(model => model.verified).length;
    checks.push({ name: "Verified models", status: verified ? "ok" : "error", detail: verified ? `${verified} verified` : "zero verified models; start `kor serve` for automatic verification, or click Verify models now in Mission Control. For a manual check: `kor models probe --model MODEL`. Work requests wait until a model passes." });
  } catch { checks.push({ name: "Verified models", status: "error", detail: "Model registry unreadable; restore models.json, then start `kor serve` or use Verify models now in Mission Control." }); }
  if (config) {
    for (const tracker of mission.tracker(config.config).github) {
      try {
        const held = await tracker.checkAccess();
        checks.push({ name: `repo ${tracker.repositoryKey} GitHub tracker`, status: "ok", detail: tracker.settings.project ? `Issues and Project v2 accessible; status mappings verified. Unset${held.length ? ` or unmapped (${held.join(', ')})` : ''} Project Status is excluded from intake; move an issue to ${tracker.settings.project.statuses.queued} to allow intake.` : "Issues accessible with repository write access" });
      }
      catch (error) { checks.push({ name: `repo ${tracker.repositoryKey} GitHub tracker`, status: "error", detail: error instanceof Error ? error.message : "Grant Issues read/write and Project read/write; classic tokens need repo and project scopes" }); }
    }
    checks.push(...await checkRepositories(config, command, mission, environment));
    if (Object.keys(config.config.repos).length === 0) checks.push({ name: "Repositories", status: "error", detail: "none configured" });
  }
  return { checks, ok: checks.every(check => check.status === "ok") };
}

export function formatDoctor(report: DoctorReport, color = false): string {
  return report.checks.map(check => {
    const line = `${check.status === "ok" ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`;
    return color ? `\u001b[${check.status === "ok" ? "32" : "31"}m${line}\u001b[0m` : line;
  }).join("\n");
}
