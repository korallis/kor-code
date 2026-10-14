import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { loadGatewayEnvironment, loadKorConfig, parseDotEnv, runtimePaths, type GatewayEnvironment, type KorPaths } from "@kor-code/config";

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
  let managementKey = gateway.managementKey;
  if (!managementKey) {
    try {
      const values = parseDotEnv(await readFile(resolve(paths.home, ".config", "cpa-management.env"), "utf8"));
      managementKey = values.CPA_MANAGEMENT_KEY;
    } catch { /* The missing-key result below is the useful diagnosis. */ }
  }
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
      const version = result.stdout.trim().split(/\r?\n/, 1)[0]?.slice(0, 80);
      return { name, status: "ok", detail: version || "available" };
    }
    return { name, status: "ok", detail: "available" };
  } catch { return { name, status: "error", detail: "unavailable" }; }
}

async function checkRepositories(config: Awaited<ReturnType<typeof loadKorConfig>>, command: DoctorCommand): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const [key, repository] of Object.entries(config.config.repos).sort(([left], [right]) => left.localeCompare(right))) {
    try {
      await access(repository.path);
      const root = (await command("git", ["-C", repository.path, "rev-parse", "--show-toplevel"])).stdout.trim();
      if (!root) throw new Error("not a git repository");
      await command("git", ["-C", repository.path, "show-ref", "--verify", `refs/heads/${repository.defaultBranch}`]);
      if (repository.remote) {
        const remote = (await command("git", ["-C", repository.path, "remote", "get-url", "origin"])).stdout.trim();
        if (remote !== repository.remote) throw new Error("origin does not match config");
      }
      checks.push({ name: `repo ${key}`, status: "ok", detail: `${root} (${repository.defaultBranch})` });
    } catch (error) {
      checks.push({ name: `repo ${key}`, status: "error", detail: error instanceof Error ? error.message : "unavailable" });
    }
  }
  return checks;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const environment = options.environment ?? process.env;
  const paths = options.paths ?? runtimePaths(environment);
  const command: DoctorCommand = options.command ?? commandRunner();
  const config = await loadKorConfig(paths.configFile, { home: paths.home });
  const checks: DoctorCheck[] = [
    { name: "Kor config", status: config.exists ? "ok" : "error", detail: config.exists ? paths.configFile : `missing (${paths.configFile})` },
    await checkCredential("Linear key", ["LINEAR_API_KEY"], resolve(paths.home, ".config", "linear", "env"), environment),
    await checkCredential("TypeSafe key", ["TYPESAFE_API_KEY", "TYPESAFE_KEY", "JEV_API_KEY"], resolve(paths.home, ".config", "typesafe", "env"), environment),
    await checkGateway(environment, paths, options.fetcher ?? globalThis.fetch),
    await checkManagement(environment, paths, options.fetcher ?? globalThis.fetch),
    await checkCommand("quota-axi", "quota-axi", ["--json", "--no-credential-refresh"], command),
    await checkCommand("Claude Code", "claude", ["--version"], command),
    await checkCommand("no-mistakes daemon", "no-mistakes", ["daemon", "status"], command),
  ];
  checks.push(...await checkRepositories(config, command));
  return { checks, ok: checks.every(check => check.status === "ok") };
}

export function formatDoctor(report: DoctorReport): string {
  return report.checks.map(check => `${check.status === "ok" ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`).join("\n");
}
