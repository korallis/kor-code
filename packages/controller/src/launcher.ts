import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Execution, Route } from "@kor-code/core";
import { EventCollector, type SessionEvent } from "./events.js";

export interface SessionLaunch { execution: Execution; repositoryPath: string; worktreePath: string; prompt: string; route?: Route; allowedTools?: readonly string[]; onSpawn?: (pid: number) => void; signal?: AbortSignal }
export interface SessionTelemetry {
  result: string;
  isError: boolean;
  permissionDenials: number;
  totalCostUsd?: number;
  durationMs?: number;
  durationApiMs?: number;
  numTurns?: number;
  model?: string;
  usage?: Readonly<Record<string, number>>;
}
export interface SessionResult {
  exitCode: number;
  signal?: NodeJS.Signals;
  events: SessionEvent[];
  stdout: string;
  stderr: string;
  telemetry?: SessionTelemetry;
  failed?: boolean;
  failureReasons?: readonly string[];
}
export interface SessionLauncherLike { launch(input: SessionLaunch): Promise<SessionResult> }
export interface SessionLauncherOptions { repoRoot?: string; command?: string; args?: string[]; env?: NodeJS.ProcessEnv; gatewayKey?: string; sandboxScript?: string; allowedTools?: readonly string[] }

// A repository must opt into mutation tools; an omitted config can only inspect.
const DEFAULT_ALLOWED_TOOLS = ["Read"] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}
function numberField(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function stringField(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function parseUsage(value: unknown): Readonly<Record<string, number>> | undefined {
  const object = record(value);
  if (!object) return undefined;
  const usage: Record<string, number> = {};
  for (const [key, item] of Object.entries(object)) {
    const number = numberField(item);
    if (number !== undefined) usage[key] = number;
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}
function parseResultEvent(events: readonly SessionEvent[]): SessionTelemetry | undefined {
  const event = [...events].reverse().find(candidate => {
    const value = record(candidate.value);
    return candidate.kind === "json" && value?.type === "result";
  });
  const value = event ? record(event.value) : undefined;
  if (!value) return undefined;
  const modelUsage = record(value.modelUsage);
  const model = stringField(value.model) ?? (modelUsage ? Object.keys(modelUsage)[0] : undefined);
  const permissionDenials = Array.isArray(value.permission_denials) ? value.permission_denials.length : value.permission_denials === undefined ? 0 : 1;
  const usage = parseUsage(value.usage);
  const totalCostUsd = numberField(value.total_cost_usd);
  const durationMs = numberField(value.duration_ms);
  const durationApiMs = numberField(value.duration_api_ms);
  const numTurns = numberField(value.num_turns);
  return {
    result: stringField(value.result) ?? "",
    isError: value.is_error === true,
    permissionDenials,
    ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(durationApiMs !== undefined ? { durationApiMs } : {}),
    ...(numTurns !== undefined ? { numTurns } : {}),
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
  };
}
function failureReasons(exitCode: number, telemetry: SessionTelemetry | undefined): string[] {
  const reasons: string[] = [];
  if (exitCode !== 0) reasons.push(`exit ${exitCode}`);
  if (!telemetry) reasons.push("missing result event");
  else {
    if (telemetry.isError) reasons.push("result is_error");
    if (telemetry.permissionDenials > 0) reasons.push(`${telemetry.permissionDenials} permission denial${telemetry.permissionDenials === 1 ? "" : "s"}`);
  }
  return reasons;
}

export class SessionLauncher implements SessionLauncherLike {
  private readonly repoRoot: string;
  constructor(private readonly options: SessionLauncherOptions = {}) { this.repoRoot = resolve(options.repoRoot ?? process.cwd()); }
  launch(input: SessionLaunch): Promise<SessionResult> {
    const collector = new EventCollector();
    const script = this.options.sandboxScript ?? resolve(this.repoRoot, "scripts/sandbox.sh");
    const allowedTools = input.allowedTools ?? this.options.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
    const toolArgs = allowedTools.length > 0 ? [...allowedTools] : [""];
    const routeArgs = [
      ...(input.route?.model ? ["--model", input.route.model] : []),
      ...(input.route?.reasoningLevel ? ["--effort", input.route.reasoningLevel] : []),
    ];
    const commandArgs = this.options.args ?? ["claude", "-p", input.prompt, ...routeArgs, "--plugin-dir", resolve(this.repoRoot, "packages/claude-plugin"), "--no-session-persistence", "--permission-mode", "dontAsk", "--allowedTools", ...toolArgs, "--output-format", "stream-json", "--verbose", "--setting-sources", ""];
    const args = ["--run", ...commandArgs];
    const tool = commandArgs[0] ?? "claude";
    const toolDir = tool.includes("/") ? dirname(tool) : this.findToolDir(tool);
    const gatewayKey = this.options.gatewayKey ?? this.options.env?.KOR_GATEWAY_KEY ?? process.env.KOR_GATEWAY_KEY ?? "";
    const gatewayKeyFile = this.options.env?.KOR_GATEWAY_KEY_FILE ?? process.env.KOR_GATEWAY_KEY_FILE;
    const gatewayUrl = this.options.env?.KOR_GATEWAY_URL ?? process.env.KOR_GATEWAY_URL;
    const env = { ...this.options.env, KOR_EXECUTION_ID: input.execution.id, KOR_WORKTREE: input.worktreePath, KOR_ROUTE_MODEL: input.route?.model ?? "", KOR_CLAUDE_BIN_DIR: toolDir, KOR_GATEWAY_KEY: gatewayKey, ...(gatewayKeyFile ? { KOR_GATEWAY_KEY_FILE: gatewayKeyFile } : {}), ...(gatewayUrl ? { KOR_GATEWAY_URL: gatewayUrl } : {}) };
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.options.command ?? "bash", [script, ...args], { cwd: input.worktreePath, env: this.isolatedEnv(env), stdio: ["ignore", "pipe", "pipe"], detached: true, signal: input.signal });
      if (child.pid) input.onSpawn?.(child.pid);
      let stdout = ""; let stderr = "";
      collector.add("started", input.execution.id);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      let stdoutBuffer = ""; let stderrBuffer = "";
      const collect = (kind: "stdout" | "stderr", chunk: string): void => {
        if (kind === "stdout") { stdout += chunk; stdoutBuffer += chunk; }
        else { stderr += chunk; stderrBuffer += chunk; }
        const buffer = kind === "stdout" ? stdoutBuffer : stderrBuffer;
        const lines = buffer.split(/\r?\n/);
        const remainder = lines.pop() ?? "";
        if (kind === "stdout") stdoutBuffer = remainder; else stderrBuffer = remainder;
        for (const line of lines) collector.line(kind, line);
      };
      child.stdout.on("data", (chunk: string) => collect("stdout", chunk));
      child.stderr.on("data", (chunk: string) => collect("stderr", chunk));
      child.on("error", error => { collector.add("error", error.message); reject(error); });
      child.on("close", (exitCode, signal) => {
        if (stdoutBuffer) collector.line("stdout", stdoutBuffer);
        if (stderrBuffer) collector.line("stderr", stderrBuffer);
        collector.add("exited", exitCode);
        const actualExitCode = exitCode ?? 1;
        const telemetry = parseResultEvent(collector.events);
        const reasons = failureReasons(actualExitCode, telemetry);
        resolvePromise({ exitCode: actualExitCode, ...(signal ? { signal } : {}), events: collector.events, stdout, stderr, ...(telemetry ? { telemetry } : {}), failed: reasons.length > 0, ...(reasons.length > 0 ? { failureReasons: reasons } : {}) });
      });
    });
  }
  private isolatedEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const sandboxHome = resolve(this.repoRoot, ".sandbox", "home", extra.KOR_EXECUTION_ID ?? "session");
    const config = resolve(this.repoRoot, ".sandbox", "claude-config", extra.KOR_EXECUTION_ID ?? "session");
    const safePath = "/usr/local/bin:/usr/bin:/bin";
    return { ...extra, PATH: safePath, HOME: sandboxHome, CLAUDE_CONFIG_DIR: config, CODEX_HOME: resolve(this.repoRoot, ".sandbox", "codex", extra.KOR_EXECUTION_ID ?? "session"), XDG_CONFIG_HOME: resolve(this.repoRoot, ".sandbox", "xdg-config", extra.KOR_EXECUTION_ID ?? "session"), XDG_DATA_HOME: resolve(this.repoRoot, ".sandbox", "xdg-data", extra.KOR_EXECUTION_ID ?? "session"), KOR_SANDBOX_HOME: sandboxHome, KOR_SANDBOX_CONFIG: config, KOR_SANDBOX_PATH: safePath };
  }
  private findToolDir(tool: string): string {
    for (const entry of (process.env.PATH ?? "").split(":")) if (entry && existsSync(join(entry, tool))) return entry;
    return "/usr/local/bin";
  }
}
