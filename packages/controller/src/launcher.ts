import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { SessionTurn, SessionLoadEvent } from "@kor-code/calibration";
import type { Execution, Route } from "@kor-code/core";
import { EventCollector, type SessionEvent } from "./events.js";
import { redact } from "@kor-code/jev";
import { permissionGuidance, sessionPermissions } from "./session-permissions.js";

export interface SessionLaunch { execution: Execution; repositoryPath: string; worktreePath: string; prompt: string; route?: Route; allowedTools?: readonly string[]; checks?: readonly string[]; onSpawn?: (pid: number) => void; signal?: AbortSignal }
export interface PermissionDenial { toolName: string; toolUseId: string; input: string }
export interface ToolResult { toolName: string; toolUseId: string; input: string; output: string; isError: boolean }
export interface SessionTelemetry {
  turns?: readonly SessionTurn[];
  startContextTokens?: number;
  contextTokenSum?: number;
  loadEvents?: readonly SessionLoadEvent[];
  result: string;
  isError: boolean;
  permissionDenials: number;
  permissionDenialDetails?: readonly PermissionDenial[];
  toolResults?: readonly ToolResult[];
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
export interface SessionLauncherOptions {
  repoRoot?: string; command?: string; args?: string[]; env?: NodeJS.ProcessEnv; gatewayKey?: string; sandboxScript?: string; allowedTools?: readonly string[];
  /** Where the daemon publishes status, so the cockpit inside the session reads it rather than the session's own sandbox home. */
  cockpit?: { statusUrl: string; stateDir: string };
  onOutput?: (executionId: string, channel: "stdout" | "stderr", text: string) => void;
  gateway?: () => Promise<{ baseUrl: string; key: string | undefined }>;
  sandboxRoot?: string;
}

// Repository policy supplies capabilities; absent policy defaults to inspection.
const DEFAULT_ALLOWED_TOOLS = ["Read"] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}
function numberField(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function stringField(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function evidenceText(value: unknown, limit: number): string {
  const redacted = redact(value);
  const text = typeof redacted === "string" ? redacted : JSON.stringify(redacted) ?? "";
  return text.length > limit ? `${text.slice(0, limit)} [truncated]` : text;
}
function denialDetails(value: unknown): PermissionDenial[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap(item => {
    const denied = record(item);
    const toolName = stringField(denied?.tool_name);
    const toolUseId = stringField(denied?.tool_use_id);
    const input = record(denied?.tool_input);
    return toolName && toolUseId && input ? [{ toolName, toolUseId, input: evidenceText(input, 1_024) }] : [];
  });
}
function toolResults(events: readonly SessionEvent[]): ToolResult[] {
  const calls = new Map<string, { toolName: string; input: string }>();
  const results: ToolResult[] = [];
  for (const event of events) {
    const value = record(event.value);
    const content = record(value?.message)?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      const block = record(item);
      if (value?.type === "assistant" && block?.type === "tool_use") {
        const id = stringField(block.id);
        const name = stringField(block.name);
        if (id && name) calls.set(id, { toolName: name, input: evidenceText(block.input, 1_024) });
      } else if (value?.type === "user" && block?.type === "tool_result") {
        const toolUseId = stringField(block.tool_use_id);
        const call = toolUseId ? calls.get(toolUseId) : undefined;
        if (toolUseId && call) results.push({ ...call, toolUseId, output: evidenceText(block.content, 4_096), isError: block.is_error === true });
      }
    }
  }
  // Keep actual shell output ahead of optional source inspection, with a bounded budget.
  const ordered = [...results.filter(result => result.toolName === "Bash"), ...results.filter(result => result.toolName !== "Bash")];
  const bounded: ToolResult[] = [];
  let remaining = 64_000;
  for (const result of ordered) {
    const size = result.input.length + result.output.length;
    if (bounded.length >= 32 || size > remaining) break;
    remaining -= size;
    bounded.push(result);
  }
  return bounded;
}
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
function contextTelemetry(events: readonly SessionEvent[]): Pick<SessionTelemetry, "turns" | "startContextTokens" | "contextTokenSum" | "loadEvents"> {
  const turns: SessionTurn[] = [];
  const byMessage = new Map<string, SessionTurn>();
  const loads = new Map<string, SessionLoadEvent[]>();
  for (const event of events) {
    if (event.kind !== "json") continue;
    const value = record(event.value);
    if (!value || value.parent_tool_use_id) continue;
    const message = record(value.message);
    if (value.type === "assistant") {
      const id = stringField(message?.id);
      const usage = parseUsage(message?.usage);
      if (!id || usage?.input_tokens === undefined) continue;
      let turn = byMessage.get(id);
      const counts = {
        inputTokens: usage.input_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        contextTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      };
      if (Object.values(counts).some(count => !Number.isInteger(count) || count < 0)) continue;
      if (turn) Object.assign(turn, counts, { outputTokens: Math.max(turn.outputTokens, counts.outputTokens) });
      else { turn = { messageId: id, ...counts }; turns.push(turn); byMessage.set(id, turn); }
      const turnNumber = turns.indexOf(turn) + 1;
      for (const item of Array.isArray(message?.content) ? message.content : []) {
        const block = record(item);
        const toolUseId = stringField(block?.id);
        const name = stringField(block?.name);
        if (block?.type !== "tool_use" || !toolUseId || !name || loads.has(toolUseId)) continue;
        const entries: SessionLoadEvent[] = [{ kind: "tool", name, toolUseId, turn: turnNumber, status: "requested" }];
        const input = record(block.input);
        const skill = name === "Skill" ? stringField(input?.skill) : undefined;
        const path = name === "Read" ? stringField(input?.file_path) : undefined;
        const readSkill = path?.replaceAll("\\", "/").match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/)?.[1];
        const skillName = skill ?? readSkill;
        if (skillName) entries.push({ kind: "skill", name: skillName, toolUseId, turn: turnNumber, status: "requested" });
        loads.set(toolUseId, entries);
      }
    } else if (value.type === "user") {
      for (const item of Array.isArray(message?.content) ? message.content : []) {
        const block = record(item);
        const id = stringField(block?.tool_use_id);
        if (block?.type !== "tool_result" || !id) continue;
        for (const load of loads.get(id) ?? []) load.status = block.is_error === true ? "failed" : "succeeded";
      }
    }
  }
  return turns[0] ? { turns, loadEvents: [...loads.values()].flat(),
    startContextTokens: turns[0].contextTokens,
    contextTokenSum: turns.reduce((sum, turn) => sum + turn.contextTokens, 0),
  } : {};
}
function parseResultEvent(events: readonly SessionEvent[]): SessionTelemetry | undefined {
  const event = [...events].reverse().find(candidate => {
    const value = record(candidate.value);
    return candidate.kind === "json" && value?.type === "result";
  });
  const value = event ? record(event.value) : undefined;
  const context = contextTelemetry(events);
  if (!value && !context.turns?.length) return undefined;
  const result = value ?? {};
  const modelUsage = record(result.modelUsage);
  const model = stringField(result.model) ?? (modelUsage ? Object.keys(modelUsage)[0] : undefined);
  const permissionDenials = Array.isArray(result.permission_denials) ? result.permission_denials.length : result.permission_denials === undefined ? 0 : 1;
  const usage = parseUsage(result.usage);
  const totalCostUsd = numberField(result.total_cost_usd);
  const durationMs = numberField(result.duration_ms);
  const durationApiMs = numberField(result.duration_api_ms);
  const numTurns = numberField(result.num_turns);
  return {
    ...context,
    result: stringField(result.result) ?? "",
    isError: result.is_error === true,
    permissionDenials,
    permissionDenialDetails: denialDetails(result.permission_denials),
    toolResults: toolResults(events),
    ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(durationApiMs !== undefined ? { durationApiMs } : {}),
    ...(numTurns !== undefined ? { numTurns } : {}),
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
  };
}
function failureReasons(exitCode: number, telemetry: SessionTelemetry | undefined, hasResultEvent: boolean): string[] {
  const reasons: string[] = [];
  if (exitCode !== 0) reasons.push(`exit ${exitCode}`);
  if (!hasResultEvent) reasons.push("missing result event");
  if (telemetry) {
    if (telemetry.isError) reasons.push("result is_error");
    if (telemetry.permissionDenials !== (telemetry.permissionDenialDetails?.length ?? 0)) reasons.push("unrecognized permission denial records");
  }
  return reasons;
}

export class SessionLauncher implements SessionLauncherLike {
  private readonly repoRoot: string;
  constructor(private readonly options: SessionLauncherOptions = {}) { this.repoRoot = resolve(options.repoRoot ?? process.cwd()); }
  async launch(input: SessionLaunch): Promise<SessionResult> {
    const collector = new EventCollector();
    const script = this.options.sandboxScript ?? resolve(this.repoRoot, "scripts/sandbox.sh");
    const checks = input.checks ?? [];
    const allowedTools = await sessionPermissions({ worktree: input.worktreePath, allowedTools: input.allowedTools ?? this.options.allowedTools ?? DEFAULT_ALLOWED_TOOLS, checks });
    const toolArgs = allowedTools.length > 0 ? [...allowedTools] : [""];
    const routeArgs = [
      ...(input.route?.model ? ["--model", input.route.model] : []),
      ...(input.route?.reasoningLevel ? ["--effort", input.route.reasoningLevel] : []),
    ];
    const commandArgs = this.options.args ?? ["claude", "-p", input.prompt + permissionGuidance(allowedTools, checks), ...routeArgs, "--plugin-dir", resolve(this.repoRoot, "packages/claude-plugin"), "--no-session-persistence", "--permission-mode", "dontAsk", "--allowedTools", ...toolArgs, "--output-format", "stream-json", "--verbose", "--setting-sources", ""];
    const args = ["--run", ...commandArgs];
    const tool = commandArgs[0] ?? "claude";
    const toolDir = tool.includes("/") ? dirname(tool) : this.findToolDir(tool);
    const gateway = await this.options.gateway?.();
    const gatewayKey = gateway?.key ?? this.options.gatewayKey ?? this.options.env?.KOR_GATEWAY_KEY ?? process.env.KOR_GATEWAY_KEY ?? "";
    const gatewayKeyFile = this.options.env?.KOR_GATEWAY_KEY_FILE ?? process.env.KOR_GATEWAY_KEY_FILE;
    const gatewayUrl = gateway?.baseUrl ?? this.options.env?.KOR_GATEWAY_URL ?? process.env.KOR_GATEWAY_URL;
    const env = { ...this.options.env, KOR_SANDBOX_ROOT: resolve(this.options.sandboxRoot ?? join(this.repoRoot, ".sandbox")), KOR_EXECUTION_ID: input.execution.id, KOR_WORKTREE: input.worktreePath, KOR_ROUTE_MODEL: input.route?.model ?? "", KOR_CLAUDE_BIN_DIR: toolDir, KOR_GATEWAY_KEY: gatewayKey, ...(gatewayKeyFile ? { KOR_GATEWAY_KEY_FILE: gatewayKeyFile } : {}), ...(gatewayUrl ? { KOR_GATEWAY_URL: gatewayUrl } : {}), ...(this.options.cockpit ? { KOR_STATUS_URL: this.options.cockpit.statusUrl, KOR_STATE_DIR: this.options.cockpit.stateDir } : {}) };
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
        for (const line of lines) { collector.line(kind, line); this.options.onOutput?.(input.execution.id, kind, `${line}\n`); }
      };
      child.stdout.on("data", (chunk: string) => collect("stdout", chunk));
      child.stderr.on("data", (chunk: string) => collect("stderr", chunk));
      child.on("error", error => { collector.add("error", error.message); reject(error); });
      child.on("close", (exitCode, signal) => {
        if (stdoutBuffer) { collector.line("stdout", stdoutBuffer); this.options.onOutput?.(input.execution.id, "stdout", stdoutBuffer); }
        if (stderrBuffer) { collector.line("stderr", stderrBuffer); this.options.onOutput?.(input.execution.id, "stderr", stderrBuffer); }
        collector.add("exited", exitCode);
        const actualExitCode = exitCode ?? 1;
        const telemetry = parseResultEvent(collector.events);
        const reasons = failureReasons(actualExitCode, telemetry, collector.events.some(event => event.kind === "json" && record(event.value)?.type === "result"));
        resolvePromise({ exitCode: actualExitCode, ...(signal ? { signal } : {}), events: collector.events, stdout, stderr, ...(telemetry ? { telemetry } : {}), failed: reasons.length > 0, ...(reasons.length > 0 ? { failureReasons: reasons } : {}) });
      });
    });
  }
  private isolatedEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const sandboxRoot = this.options.sandboxRoot ?? resolve(this.repoRoot, ".sandbox");
    const sandboxHome = resolve(sandboxRoot, "home", extra.KOR_EXECUTION_ID ?? "session");
    const config = resolve(sandboxRoot, "claude-config", extra.KOR_EXECUTION_ID ?? "session");
    const safePath = "/usr/local/bin:/usr/bin:/bin";
    return { ...extra, PATH: safePath, HOME: sandboxHome, CLAUDE_CONFIG_DIR: config, CODEX_HOME: resolve(sandboxRoot, "codex", extra.KOR_EXECUTION_ID ?? "session"), XDG_CONFIG_HOME: resolve(sandboxRoot, "xdg-config", extra.KOR_EXECUTION_ID ?? "session"), XDG_DATA_HOME: resolve(sandboxRoot, "xdg-data", extra.KOR_EXECUTION_ID ?? "session"), KOR_SANDBOX_HOME: sandboxHome, KOR_SANDBOX_CONFIG: config, KOR_SANDBOX_PATH: safePath };
  }
  private findToolDir(tool: string): string {
    for (const entry of (process.env.PATH ?? "").split(":")) if (entry && existsSync(join(entry, tool))) return entry;
    return "/usr/local/bin";
  }
}
