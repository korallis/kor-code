#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDoctor, runDoctor } from "./doctor.js";
import { runPlan } from "./plan.js";
import { ensureRuntimeDirectories, loadGatewayEnvironment, loadKorConfig, repositoryKeyForIssue, runtimePaths } from "@kor-code/config";
import { HttpLinearClient, LinearStore, stableId, startWrites, workflowMapping, type LinearWrite } from "@kor-code/linear";
import { KorDaemon, readStatus } from "@kor-code/daemon";
import { CalibrationStore, buildReport, formatReport } from "@kor-code/calibration";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController } from "@kor-code/controller";
import { GatewayAdapter } from "@kor-code/gateway-adapter";
import { JevClient, JevDecisionCore } from "@kor-code/jev";

function flag(args: readonly string[], name: string): boolean { return args.includes(name); }
function valueAfter(args: readonly string[], name: string): string | undefined { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
function writeDescription(write: LinearWrite): string {
  if (write.kind === "state") return `state ${write.stateId}`;
  if (write.kind === "comment") return `comment ${write.id} (${write.body})`;
  if (write.kind === "attachment") return `attachment ${write.url}`;
  if (write.kind === "session") return `agent-session ${write.session.id}`;
  if (write.kind === "summary") return `summary ${write.sessionId}`;
  return `activity ${write.id}`;
}
function print(value: unknown, json: boolean): void { process.stdout.write(`${json ? JSON.stringify(value, null, 2) : typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`); }

async function runLinear(args: readonly string[]): Promise<number> {
  const issueId = args[1];
  if (!issueId || args.slice(1).some(arg => arg.startsWith("-") && arg !== "--dry-run")) throw new Error("Usage: kor run LEE-<number> [--dry-run]");
  const dryRun = flag(args, "--dry-run");
  const loaded = await loadKorConfig();
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
  if (!dryRun) for (const write of writes) await client.apply(write);
  return 0;
}
async function cancelLinear(args: readonly string[]): Promise<number> {
  const issueId = args[1];
  if (!issueId || args.length > 2) throw new Error("Usage: kor cancel LEE-<number>");
  const loaded = await loadKorConfig();
  const client = new HttpLinearClient({ writes: {} });
  const issue = await client.getIssue(issueId);
  const repositoryKey = repositoryKeyForIssue(issue, loaded.config);
  const states = workflowMapping(await client.listWorkflowStates(issue.teamKey));
  const writes: LinearWrite[] = [{ kind: "state", issueId: issue.id, stateId: states.queued.id }, { kind: "comment", id: stableId("kor-progress", `${issue.id}:cancel`), issueId: issue.id, body: `Kor canceled execution for ${issue.id}; state → ${states.queued.name ?? "Todo"}` }];
  process.stdout.write(`Kor cancel ${issue.id}; repository=${repositoryKey}\n`);
  for (const write of writes) { process.stdout.write(`WRITE ${writeDescription(write)}\n`); await client.apply(write); }
  return 0;
}
async function status(args: readonly string[]): Promise<number> {
  const paths = runtimePaths(); const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  print(await readStatus(paths, Math.max(2_000, loaded.config.pollIntervalSeconds * 2_000)), flag(args, "--json")); return 0;
}
async function updateQueue(command: "retry", args: readonly string[]): Promise<number> {
  const issueId = args.find(arg => !arg.startsWith("-")); if (!issueId) throw new Error(`Usage: kor ${command} ISSUE-ID`);
  const store = new LinearStore(runtimePaths().databaseFile); try { const accepted = store.requeue(issueId); print({ issueId, command, accepted }, flag(args, "--json")); return accepted ? 0 : 1; } finally { store.close(); }
}
async function logs(args: readonly string[]): Promise<number> {
  const executionId = args.find(arg => !arg.startsWith("-")); if (!executionId) throw new Error("Usage: kor logs EXECUTION-ID");
  let content = ""; try { content = await readFile(join(runtimePaths().logsDir, basename(executionId) + ".log"), "utf8"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  print(flag(args, "--json") ? { executionId, content } : content.trimEnd(), false); return 0;
}
async function calibrationReport(args: readonly string[]): Promise<number> {
  if (args[0] !== "report") throw new Error("Usage: kor calibrate report [--since ISO-8601] [--json]");
  const since = valueAfter(args, "--since"); if (since !== undefined && !Number.isFinite(Date.parse(since))) throw new Error("--since must be an ISO-8601 timestamp");
  const store = new CalibrationStore(runtimePaths().databaseFile); try { const report = buildReport(store, since); if (flag(args, "--json")) print(report, true); else process.stdout.write(`${formatReport(report)}\n`); return 0; } finally { store.close(); }
}
async function serve(args: readonly string[]): Promise<number> {
  const paths = runtimePaths(); const loaded = await loadKorConfig(paths.configFile, { home: paths.home }); await ensureRuntimeDirectories(paths);
  const portValue = valueAfter(args, "--port"); const port = portValue ? Number(portValue) : 8327;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("--port must be a valid TCP port");
  const jevEnabled = flag(args, "--jev"); const calibrationEnabled = !flag(args, "--no-calibration");
  const sampleRateValue = valueAfter(args, "--calibration-rate"); const sampleRate = sampleRateValue === undefined ? loaded.config.calibration.sampleRate : Number(sampleRateValue);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) throw new Error("--calibration-rate must be between 0 and 1");
  const baselineModel = valueAfter(args, "--baseline-model");
  const calibrationConfig = { ...loaded.config.calibration, sampleRate, baselineRoute: { ...loaded.config.calibration.baselineRoute, ...(baselineModel ? { model: baselineModel } : {}) } };
  const repositories = new RepositoryRegistry(Object.entries(loaded.config.repos).map(([key, repository]) => ({ key, path: repository.path, defaultBranch: repository.defaultBranch, allowedTools: repository.toolAllowlist })));
  const calibration = calibrationEnabled ? new CalibrationStore(paths.databaseFile) : undefined;
  let catalogue; let jev;
  if (jevEnabled) {
    const gateway = await loadGatewayEnvironment(paths.gatewayEnvFile); const adapter = new GatewayAdapter({ baseUrl: gateway.baseUrl, ...(gateway.key ? { apiKey: gateway.key } : {}) });
    const models = await adapter.catalogue({ capabilities: ["streaming", "tool_calls"] }); if (models.length === 0) throw new Error("--jev requires at least one verified gateway model");
    catalogue = models.map(model => ({ provider: model.provider ?? "unknown", model: model.id, capabilities: Object.entries(model.capabilities).map(([name, supported]) => ({ name, supported })) }));
    jev = new JevDecisionCore(new JevClient(), calibration);
  }
  const controller = createController({ repositories, worktrees: new GitWorktreeManager(paths.worktreesDir), launcher: new SessionLauncher({ repoRoot: process.cwd() }), limits: new ConcurrencyLimiter({ total: loaded.config.limits.total, perRepository: loaded.config.limits.perRepository, ...(loaded.config.limits.perProvider ? { perProvider: loaded.config.limits.perProvider } : {}) }), defaultRoute: loaded.config.defaultRoute, ...(jev ? { jev } : {}), ...(catalogue ? { catalogue } : {}), ...(calibration ? { calibration: { store: calibration, sampleRate: calibrationConfig.sampleRate, baselineRoute: calibrationConfig.baselineRoute } } : {}) });
  const daemon = new KorDaemon({ paths, config: loaded.config, linear: new HttpLinearClient(), controller, port }); const handle = await daemon.start(); process.stdout.write(`kor daemon listening on http://127.0.0.1:${port}/status\n`);
  await new Promise<void>(resolve => { const stop = () => { void handle.stop().then(resolve); }; process.once("SIGINT", stop); process.once("SIGTERM", stop); }); calibration?.close(); return 0;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? "help";
  try {
    if (command === "run" || command === "cancel") return command === "run" ? await runLinear(args) : await cancelLinear(args);
    if (command === "doctor" && args.length === 1) { const report = await runDoctor(); process.stdout.write(`${formatDoctor(report, Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined)}\n`); return report.ok ? 0 : 1; }
    if (command === "plan" && args.length === 2) { const result = await runPlan(args[1]!); process.stdout.write(`${result.output}\n${result.commentWritten ? "linear: clarification comment written" : "linear: no clarification needed"}\n`); return result.plan.fallback || result.plan.decisions.some(decision => decision.escalated || decision.kind === "readiness" && decision.choice === "blocked") ? 1 : 0; }
    if (command === "status") return status(args.slice(1));
    if (command === "retry") return updateQueue(command, args.slice(1));
    if (command === "logs") return logs(args.slice(1));
    if (command === "calibrate") return calibrationReport(args.slice(1));
    if (command === "serve") return serve(args.slice(1));
  } catch (error) { process.stderr.write(`FAIL ${command}: ${error instanceof Error ? error.message : "unable to run"}\n`); return 1; }
  process.stdout.write("Usage: kor serve [--jev] [--no-calibration] [--calibration-rate 0.25] [--baseline-model MODEL] | kor status [--json] | kor plan LEE-57 | kor run LEE-<number> [--dry-run] | kor cancel LEE-<number> | kor retry ISSUE-ID | kor logs EXECUTION-ID | kor calibrate report [--since ISO-8601] [--json] | kor doctor\n");
  return ["help", "--help", "-h"].includes(command) ? 0 : 2;
}
const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
