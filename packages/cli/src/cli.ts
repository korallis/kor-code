#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDoctor, runDoctor } from "./doctor.js";
import { ensureRuntimeDirectories, loadKorConfig, runtimePaths } from "@kor-code/config";
import { HttpLinearClient, LinearStore } from "@kor-code/linear";
import { KorDaemon, readStatus } from "@kor-code/daemon";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController } from "@kor-code/controller";

function jsonFlag(args: readonly string[]): boolean { return args.includes("--json"); }
function valueAfter(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function print(value: unknown, json: boolean): void {
  process.stdout.write(`${json ? JSON.stringify(value, null, 2) : typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

async function status(args: readonly string[]): Promise<number> {
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  print(await readStatus(paths, Math.max(2_000, loaded.config.pollIntervalSeconds * 2_000)), jsonFlag(args));
  return 0;
}

async function runIssue(args: readonly string[]): Promise<number> {
  const issueId = args.find(arg => !arg.startsWith("-"));
  if (!issueId) { process.stderr.write("Usage: kor run ISSUE-ID [--dry-run] [--json]\n"); return 2; }
  const json = jsonFlag(args);
  const dryRun = args.includes("--dry-run");
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  if (dryRun) {
    print({ issueId, dryRun: true, intake: loaded.config.intakeLabel, route: loaded.config.defaultRoute, planned: ["enqueue durable assignment", "move Todo to In Progress", "write progress comment", "run isolated session", "publish evidence"] }, json);
    return 0;
  }
  const store = new LinearStore(paths.databaseFile);
  try {
    const assignment = store.enqueue(issueId);
    print({ issueId, executionId: assignment.executionId, status: assignment.status, queued: true }, json);
    return 0;
  } finally { store.close(); }
}

async function updateQueue(command: "cancel" | "retry", args: readonly string[]): Promise<number> {
  const issueId = args.find(arg => !arg.startsWith("-"));
  if (!issueId) { process.stderr.write(`Usage: kor ${command} ISSUE-ID [--json]\n`); return 2; }
  const paths = runtimePaths();
  const store = new LinearStore(paths.databaseFile);
  try {
    const accepted = command === "cancel" ? store.requestCancel(issueId) : store.requeue(issueId);
    print({ issueId, command, accepted }, jsonFlag(args));
    return accepted ? 0 : 1;
  } finally { store.close(); }
}

async function logs(args: readonly string[]): Promise<number> {
  const executionId = args.find(arg => !arg.startsWith("-"));
  if (!executionId) { process.stderr.write("Usage: kor logs EXECUTION-ID [--json]\n"); return 2; }
  const paths = runtimePaths();
  let content = "";
  try { content = await readFile(join(paths.logsDir, basename(executionId) + ".log"), "utf8"); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  print(jsonFlag(args) ? { executionId, content } : content.trimEnd(), false);
  return 0;
}

async function serve(args: readonly string[]): Promise<number> {
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  await ensureRuntimeDirectories(paths);
  const portValue = valueAfter(args, "--port");
  const port = portValue ? Number(portValue) : 8327;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("--port must be a valid TCP port");
  const repositories = new RepositoryRegistry(Object.entries(loaded.config.repos).map(([key, repository]) => ({ key, path: repository.path, defaultBranch: repository.defaultBranch, allowedTools: repository.toolAllowlist })));
  const controller = createController({
    repositories,
    worktrees: new GitWorktreeManager(paths.worktreesDir),
    launcher: new SessionLauncher({ repoRoot: process.cwd() }),
    limits: new ConcurrencyLimiter({ total: loaded.config.limits.total, perRepository: loaded.config.limits.perRepository, ...(loaded.config.limits.perProvider ? { perProvider: loaded.config.limits.perProvider } : {}) }),
    defaultRoute: loaded.config.defaultRoute,
  });
  const daemon = new KorDaemon({ paths, config: loaded.config, linear: new HttpLinearClient(), controller, port });
  const handle = await daemon.start();
  process.stdout.write(`kor daemon listening on http://127.0.0.1:${port}/status\n`);
  await new Promise<void>(resolve => {
    const stop = () => { void handle.stop().then(resolve); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  });
  return 0;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? "help";
  try {
    if (command === "doctor" && args.length === 1) {
      const report = await runDoctor();
      process.stdout.write(`${formatDoctor(report, Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined)}\n`);
      return report.ok ? 0 : 1;
    }
    if (command === "status") return status(args.slice(1));
    if (command === "run") return runIssue(args.slice(1));
    if (command === "cancel" || command === "retry") return updateQueue(command, args.slice(1));
    if (command === "logs") return logs(args.slice(1));
    if (command === "serve") return serve(args.slice(1));
  } catch (error) {
    process.stderr.write(`FAIL ${command}: ${error instanceof Error ? error.message : "unable to run"}\n`);
    return 1;
  }
  process.stdout.write("Usage: kor serve | kor status [--json] | kor run ISSUE-ID [--dry-run] | kor cancel ISSUE-ID | kor retry ISSUE-ID | kor logs EXECUTION-ID | kor doctor | kor models list | kor models probe [--family family] [--model model]\n");
  return ["help", "--help", "-h"].includes(command) ? 0 : 2;
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
