#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDoctor, runDoctor } from "./doctor.js";
import { ensureRuntimeDirectories, loadKorConfig, loadGatewayEnvironment, runtimePaths } from "@kor-code/config";
import { HttpLinearClient, LinearStore } from "@kor-code/linear";
import { KorDaemon, readStatus } from "@kor-code/daemon";
import { CalibrationStore, buildReport, formatReport } from "@kor-code/calibration";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController } from "@kor-code/controller";
import { GatewayAdapter } from "@kor-code/gateway-adapter";
import { JevClient, JevDecisionCore } from "@kor-code/jev";

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

async function calibrationReport(args: readonly string[]): Promise<number> {
  const subcommand = args.find(arg => !arg.startsWith("-"));
  if (subcommand !== "report") { process.stderr.write("Usage: kor calibrate report [--since ISO-8601] [--json]\n"); return 2; }
  const since = valueAfter(args, "--since");
  if (since !== undefined && !Number.isFinite(Date.parse(since))) { process.stderr.write("--since must be an ISO-8601 timestamp\n"); return 2; }
  const store = new CalibrationStore(runtimePaths().databaseFile);
  try {
    const report = buildReport(store, since);
    if (jsonFlag(args)) print(report, true);
    else process.stdout.write(`${formatReport(report)}\n`);
    return 0;
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
  const jevEnabled = args.includes("--jev");
  const calibrationEnabled = !args.includes("--no-calibration");
  const sampleRateValue = valueAfter(args, "--calibration-rate");
  const sampleRate = sampleRateValue === undefined ? loaded.config.calibration.sampleRate : Number(sampleRateValue);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) throw new Error("--calibration-rate must be between 0 and 1");
  const baselineModel = valueAfter(args, "--baseline-model");
  const calibrationConfig = { ...loaded.config.calibration, sampleRate, baselineRoute: { ...loaded.config.calibration.baselineRoute, ...(baselineModel ? { model: baselineModel } : {}) } };
  const repositories = new RepositoryRegistry(Object.entries(loaded.config.repos).map(([key, repository]) => ({ key, path: repository.path, defaultBranch: repository.defaultBranch, allowedTools: repository.toolAllowlist })));
  const calibration = calibrationEnabled ? new CalibrationStore(paths.databaseFile) : undefined;
  let catalogue;
  let jev;
  if (jevEnabled) {
    const gateway = await loadGatewayEnvironment(paths.gatewayEnvFile);
    const adapter = new GatewayAdapter({ baseUrl: gateway.baseUrl, ...(gateway.key ? { apiKey: gateway.key } : {}) });
    const models = await adapter.catalogue({ capabilities: ["streaming", "tool_calls"] });
    if (models.length === 0) throw new Error("--jev requires at least one verified gateway model");
    catalogue = models.map(model => ({ provider: model.provider ?? "unknown", model: model.id, capabilities: Object.entries(model.capabilities).map(([name, supported]) => ({ name, supported })) }));
    jev = new JevDecisionCore(new JevClient(), calibration);
  }
  const controller = createController({
    repositories,
    worktrees: new GitWorktreeManager(paths.worktreesDir),
    launcher: new SessionLauncher({ repoRoot: process.cwd() }),
    limits: new ConcurrencyLimiter({ total: loaded.config.limits.total, perRepository: loaded.config.limits.perRepository, ...(loaded.config.limits.perProvider ? { perProvider: loaded.config.limits.perProvider } : {}) }),
    defaultRoute: loaded.config.defaultRoute,
    ...(jev ? { jev } : {}),
    ...(catalogue ? { catalogue } : {}),
    ...(calibration ? { calibration: { store: calibration, sampleRate: calibrationConfig.sampleRate, baselineRoute: calibrationConfig.baselineRoute } } : {}),
  });
  const daemon = new KorDaemon({ paths, config: loaded.config, linear: new HttpLinearClient(), controller, port });
  const handle = await daemon.start();
  process.stdout.write(`kor daemon listening on http://127.0.0.1:${port}/status\n`);
  await new Promise<void>(resolve => {
    const stop = () => { void handle.stop().then(resolve); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  });
  calibration?.close();
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
    if (command === "calibrate") return calibrationReport(args.slice(1));
    if (command === "serve") return serve(args.slice(1));
  } catch (error) {
    process.stderr.write(`FAIL ${command}: ${error instanceof Error ? error.message : "unable to run"}\n`);
    return 1;
  }
  process.stdout.write("Usage: kor serve [--jev] [--no-calibration] [--calibration-rate 0.25] [--baseline-model MODEL] | kor status [--json] | kor run ISSUE-ID [--dry-run] | kor cancel ISSUE-ID | kor retry ISSUE-ID | kor logs EXECUTION-ID | kor calibrate report [--since ISO-8601] [--json] | kor doctor | kor models list | kor models probe [--family family] [--model model]\n");
  return ["help", "--help", "-h"].includes(command) ? 0 : 2;
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
