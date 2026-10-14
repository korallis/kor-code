#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDoctor, runDoctor } from "./doctor.js";
import { runPlan } from "./plan.js";
import { ensureRuntimeDirectories, loadGatewayEnvironment, loadKorConfig, repositoryKeyForIssue, runtimePaths } from "@kor-code/config";
import { HttpLinearClient, LinearStore, stableId, startWrites, workflowMapping, type LinearWrite } from "@kor-code/linear";
import { KorDaemon, readStatus } from "@kor-code/daemon";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController } from "@kor-code/controller";
import { GatewayAdapter, readModelRegistry } from "@kor-code/gateway-adapter";
import { JevClient, JevDecisionCore } from "@kor-code/jev";
import { CalibrationStore, buildReport, formatReport } from "@kor-code/calibration";
import type { CatalogueModel } from "@kor-code/core";

function jsonFlag(args: readonly string[]): boolean { return args.includes("--json"); }
function valueAfter(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function print(value: unknown, json: boolean): void {
  process.stdout.write(`${json ? JSON.stringify(value, null, 2) : typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}
function writeDescription(write: LinearWrite): string {
  if (write.kind === "state") return `state ${write.stateId}`;
  if (write.kind === "comment") return `comment ${write.id} (${write.body})`;
  if (write.kind === "attachment") return `attachment ${write.url}`;
  if (write.kind === "session") return `agent-session ${write.session.id}`;
  if (write.kind === "summary") return `summary ${write.sessionId}`;
  return `activity ${write.id}`;
}

async function status(args: readonly string[]): Promise<number> {
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  print(await readStatus(paths, Math.max(2_000, loaded.config.pollIntervalSeconds * 2_000)), jsonFlag(args));
  return 0;
}

/** Moves the issue to In Progress with a Kor comment, then queues it for `kor serve`. */
async function runIssue(args: readonly string[]): Promise<number> {
  const issueId = args.find(arg => !arg.startsWith("-"));
  if (!issueId || args.some(arg => arg.startsWith("-") && arg !== "--dry-run")) throw new Error("Usage: kor run LEE-<number> [--dry-run]");
  const dryRun = args.includes("--dry-run");
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  const client = new HttpLinearClient(dryRun ? {} : { writes: {} });
  const issue = await client.getIssue(issueId);
  const repositoryKey = repositoryKeyForIssue(issue, loaded.config);
  const states = workflowMapping(await client.listWorkflowStates(issue.teamKey));
  if (issue.stateId !== states.queued.id && issue.stateId !== states.running.id) throw new Error(`Linear issue is ${issue.stateType}; kor run accepts Todo or an existing In Progress run only`);
  const executionId = stableId("kor-execution", issue.id);
  const assignment = { executionId, issueId: issue.id, sessionId: stableId("kor-session", issue.id), status: "queued" as const };
  const writes = startWrites(assignment, states, client);
  process.stdout.write(`Kor run ${issue.id}; repository=${repositoryKey}; state=${issue.stateType}; mode=${dryRun ? "dry-run" : "apply"}\n`);
  for (const write of writes) process.stdout.write(`${dryRun ? "PLAN" : "WRITE"} ${writeDescription(write)}\n`);
  if (dryRun) { process.stdout.write("PLAN enqueue for kor serve\n"); return 0; }
  for (const write of writes) await client.apply(write);
  const store = new LinearStore(paths.databaseFile);
  try {
    // The poller queues by Linear's stable UUID too, so one issue is queued once.
    const queued = store.enqueue(issue.id);
    process.stdout.write(`QUEUED ${issueId}; execution=${queued.executionId}\n`);
    return 0;
  } finally { store.close(); }
}

/** Moves the issue back to Todo with a Kor comment and asks the daemon to stop the run. */
async function cancelIssue(args: readonly string[]): Promise<number> {
  const issueId = args.find(arg => !arg.startsWith("-"));
  if (!issueId || args.length > 1) throw new Error("Usage: kor cancel LEE-<number>");
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  const client = new HttpLinearClient({ writes: {} });
  const issue = await client.getIssue(issueId);
  const repositoryKey = repositoryKeyForIssue(issue, loaded.config);
  const states = workflowMapping(await client.listWorkflowStates(issue.teamKey));
  const writes: LinearWrite[] = [
    { kind: "state", issueId: issue.id, stateId: states.queued.id },
    { kind: "comment", id: stableId("kor-progress", `${issue.id}:cancel`), issueId: issue.id, body: `Kor canceled execution for ${issue.id}; state → ${states.queued.name ?? "Todo"}` },
  ];
  process.stdout.write(`Kor cancel ${issue.id}; repository=${repositoryKey}\n`);
  for (const write of writes) { process.stdout.write(`WRITE ${writeDescription(write)}\n`); await client.apply(write); }
  const store = new LinearStore(paths.databaseFile);
  try { process.stdout.write(`QUEUE cancel ${store.requestCancel(issue.id) ? "requested" : "not queued"}\n`); }
  finally { store.close(); }
  return 0;
}

async function retryIssue(args: readonly string[]): Promise<number> {
  const issueId = args.find(arg => !arg.startsWith("-"));
  if (!issueId) { process.stderr.write("Usage: kor retry ISSUE-ID [--json]\n"); return 2; }
  const paths = runtimePaths();
  // Assignments are keyed by the Linear UUID; resolve a LEE-n key first.
  const key = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(issueId) ? (await new HttpLinearClient().getIssue(issueId)).id : issueId;
  const store = new LinearStore(paths.databaseFile);
  try {
    const accepted = store.retry(key);
    print({ issueId, command: "retry", accepted }, jsonFlag(args));
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

async function calibrationReport(args: readonly string[]): Promise<number> {
  if (args[0] !== "report") throw new Error("Usage: kor calibrate report [--since ISO-8601] [--json]");
  const since = valueAfter(args, "--since");
  if (since !== undefined && !Number.isFinite(Date.parse(since))) throw new Error("--since must be an ISO-8601 timestamp");
  const store = new CalibrationStore(runtimePaths().databaseFile);
  try {
    const report = buildReport(store, since);
    print(jsonFlag(args) ? report : formatReport(report), false);
    return 0;
  } finally { store.close(); }
}

async function serve(args: readonly string[]): Promise<number> {
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  await ensureRuntimeDirectories(paths);
  const portValue = valueAfter(args, "--port");
  const port = portValue ? Number(portValue) : 8327;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535 || port === 8317) throw new Error("--port must be a valid non-8317 TCP port");
  const statusUrl = `http://127.0.0.1:${port}/status`;
  const jevEnabled = args.includes("--jev");
  const calibrationEnabled = !args.includes("--no-calibration");
  const sampleRateValue = valueAfter(args, "--calibration-rate");
  const sampleRate = sampleRateValue === undefined ? loaded.config.calibration.sampleRate : Number(sampleRateValue);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) throw new Error("--calibration-rate must be between 0 and 1");
  const baselineModel = valueAfter(args, "--baseline-model");
  const calibrationConfig = { ...loaded.config.calibration, sampleRate, baselineRoute: { ...loaded.config.calibration.baselineRoute, ...(baselineModel ? { model: baselineModel } : {}) } };
  const repositories = new RepositoryRegistry(Object.entries(loaded.config.repos).map(([key, repository]) => ({ key, path: repository.path, defaultBranch: repository.defaultBranch, allowedTools: repository.toolAllowlist, checks: repository.checks })));
  const calibration = calibrationEnabled ? new CalibrationStore(paths.databaseFile) : undefined;
  let catalogue: CatalogueModel[] | undefined;
  let jev: JevDecisionCore | undefined;
  if (jevEnabled) {
    const gatewayConfig = await loadGatewayEnvironment(paths.gatewayEnvFile);
    const gatewayAdapter = new GatewayAdapter({ baseUrl: gatewayConfig.baseUrl, ...(gatewayConfig.key ? { apiKey: gatewayConfig.key } : {}) });
    const models = await gatewayAdapter.catalogue({ capabilities: ["streaming", "tool_calls"] });
    if (models.length === 0) throw new Error("--jev requires at least one verified gateway model");
    catalogue = models.map(model => ({ provider: model.provider ?? "unknown", model: model.id, capabilities: Object.entries(model.capabilities).map(([name, supported]) => ({ name, supported })) }));
    jev = new JevDecisionCore(new JevClient(), calibration);
  }
  const controller = createController({
    repositories,
    worktrees: new GitWorktreeManager(paths.worktreesDir),
    // Execution sessions load the cockpit, so they are told where this daemon publishes.
    launcher: new SessionLauncher({ repoRoot: process.cwd(), cockpit: { statusUrl, stateDir: paths.stateDir } }),
    limits: new ConcurrencyLimiter({ total: loaded.config.limits.total, perRepository: loaded.config.limits.perRepository, ...(loaded.config.limits.perProvider ? { perProvider: loaded.config.limits.perProvider } : {}) }),
    defaultRoute: loaded.config.defaultRoute,
    ...(jev ? { jev } : {}),
    ...(catalogue ? { catalogue } : {}),
    ...(calibration ? { calibration: { store: calibration, sampleRate: calibrationConfig.sampleRate, baselineRoute: calibrationConfig.baselineRoute } } : {}),
  });
  // The cockpit's account view and the override policy read the gateway's
  // management API and the verified model registry through the daemon.
  const gateway = new GatewayAdapter();
  const verifiedModels = async () => (await readModelRegistry(paths.modelsFile)).models.filter(model => model.verified).map(model => model.model);
  const daemon = new KorDaemon({ paths, config: loaded.config, linear: new HttpLinearClient({ writes: {} }), controller, port, gateway, verifiedModels });
  const handle = await daemon.start();
  process.stdout.write(`kor daemon listening on ${statusUrl}\n`);
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
    if (command === "plan" && args.length === 2) {
      const result = await runPlan(args[1]!);
      process.stdout.write(`${result.output}\n${result.commentWritten ? "linear: clarification comment written" : "linear: no clarification needed"}\n`);
      return result.plan.fallback || result.plan.decisions.some(decision => decision.escalated || decision.kind === "readiness" && decision.choice === "blocked") ? 1 : 0;
    }
    if (command === "status") return await status(args.slice(1));
    if (command === "run") return await runIssue(args.slice(1));
    if (command === "cancel") return await cancelIssue(args.slice(1));
    if (command === "retry") return await retryIssue(args.slice(1));
    if (command === "logs") return await logs(args.slice(1));
    if (command === "calibrate") return await calibrationReport(args.slice(1));
    if (command === "serve") return await serve(args.slice(1));
  } catch (error) {
    process.stderr.write(`FAIL ${command}: ${error instanceof Error ? error.message : "unable to run"}\n`);
    return 1;
  }
  process.stdout.write("Usage: kor serve | kor status [--json] | kor plan LEE-57 | kor run LEE-<number> [--dry-run] | kor cancel LEE-<number> | kor retry ISSUE-ID | kor logs EXECUTION-ID | kor doctor | kor models list | kor models probe [--family family] [--model model]\n");
  return ["help", "--help", "-h"].includes(command) ? 0 : 2;
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
