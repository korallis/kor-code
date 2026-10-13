import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Execution, Route } from "@kor-code/core";
import { EventCollector, type SessionEvent } from "./events.js";

export interface SessionLaunch { execution: Execution; repositoryPath: string; worktreePath: string; prompt: string; route?: Route }
export interface SessionResult { exitCode: number; signal?: NodeJS.Signals; events: SessionEvent[]; stdout: string; stderr: string }
export interface SessionLauncherLike { launch(input: SessionLaunch): Promise<SessionResult> }
export interface SessionLauncherOptions { repoRoot?: string; command?: string; args?: string[]; env?: NodeJS.ProcessEnv; gatewayKey?: string; sandboxScript?: string }

export class SessionLauncher implements SessionLauncherLike {
  private readonly repoRoot: string;
  constructor(private readonly options: SessionLauncherOptions = {}) { this.repoRoot = resolve(options.repoRoot ?? process.cwd()); }
  launch(input: SessionLaunch): Promise<SessionResult> {
    const collector = new EventCollector();
    const script = this.options.sandboxScript ?? resolve(this.repoRoot, "scripts/sandbox.sh");
    const commandArgs = this.options.args ?? ["claude", "-p", input.prompt, "--plugin-dir", resolve(this.repoRoot, "packages/claude-plugin"), "--no-session-persistence", "--permission-mode", "dontAsk", "--output-format", "text", "--bare", "--setting-sources", ""];
    const args = ["--run", ...commandArgs];
    const tool = commandArgs[0] ?? "claude";
    const toolDir = tool.includes("/") ? dirname(tool) : this.findToolDir(tool);
    const env = { ...this.options.env, KOR_EXECUTION_ID: input.execution.id, KOR_WORKTREE: input.worktreePath, KOR_ROUTE_MODEL: input.route?.model ?? "", KOR_CLAUDE_BIN_DIR: toolDir, KOR_GATEWAY_KEY: this.options.gatewayKey ?? this.options.env?.KOR_GATEWAY_KEY ?? "" };
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.options.command ?? "bash", [script, ...args], { cwd: input.worktreePath, env: this.isolatedEnv(env), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      collector.add("started", input.execution.id);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; for (const line of chunk.split(/\r?\n/)) collector.line("stdout", line); });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; for (const line of chunk.split(/\r?\n/)) collector.line("stderr", line); });
      child.on("error", error => { collector.add("error", error.message); reject(error); });
      child.on("close", (exitCode, signal) => { collector.add("exited", exitCode); resolvePromise({ exitCode: exitCode ?? 1, ...(signal ? { signal } : {}), events: collector.events, stdout, stderr }); });
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
