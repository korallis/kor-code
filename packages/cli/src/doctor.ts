import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { loadGatewayEnvironment, loadKorConfig, parseDotEnv, runtimePaths, type GatewayEnvironment, type KorPaths } from "@kor-code/config";
import { sessionPermissions, sessionTools } from "@kor-code/controller";

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

function commandRunner(): DoctorCommand {
  return async (file, args) => {
    if (!file) throw new Error("command name is empty");
    return execFileAsync(file, [...args], { timeout: 10_000, maxBuffer: 256 * 1024 });
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

async function checkRepositories(config: Awaited<ReturnType<typeof loadKorConfig>>, command: DoctorCommand): Promise<DoctorCheck[]> {
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
      checks.push({ name: `repo ${key}`, status: "ok", detail: `${repository.path} (${repository.defaultBranch})` });
      const permissions = await sessionPermissions({ worktree: repository.path, allowedTools: repository.toolAllowlist, checks: repository.checks, ...(repository.tools ? { tools: repository.tools } : {}) });
      const tools = sessionTools(permissions, repository.tools);
      checks.push({ name: `repo ${key} tools`, status: "ok", detail: `${tools.join(", ") || "none"} (${repository.tools ? "tools override" : "allowlist base names plus Glob, Grep"}); availability does not grant command permissions` });
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
  const command: DoctorCommand = options.command ?? commandRunner();
  let config: Awaited<ReturnType<typeof loadKorConfig>> | undefined;
  let configCheck: DoctorCheck;
  try {
    config = await loadKorConfig(paths.configFile, { home: paths.home });
    configCheck = { name: "Kor config", status: config.exists ? "ok" : "error", detail: config.exists ? paths.configFile : `missing (${paths.configFile})` };
  } catch { configCheck = { name: "Kor config", status: "error", detail: "invalid or unreadable; see docs/configuration.md" }; }
  const checks: DoctorCheck[] = [
    configCheck,
    await checkCredential("Linear key", ["LINEAR_API_KEY"], resolve(paths.home, ".config", "linear", "env"), environment),
    await checkCredential("TypeSafe key", ["TYPESAFE_API_KEY", "TYPESAFE_KEY", "JEV_API_KEY"], resolve(paths.home, ".config", "typesafe", "env"), environment),
    await checkGateway(environment, paths, options.fetcher ?? globalThis.fetch),
    await checkManagement(environment, paths, options.fetcher ?? globalThis.fetch),
    await checkCommand("quota-axi", "quota-axi", ["--json", "--no-credential-refresh"], command),
    await checkCommand("Claude Code", "claude", ["--version"], command),
    await checkCommand("no-mistakes daemon", "no-mistakes", ["daemon", "status"], command),
  ];
  if (config) {
    checks.push(...await checkRepositories(config, command));
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
