#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDoctor, runDoctor } from "./doctor.js";
import { runPlan } from "./plan.js";
import { createServeRouting } from "./serve-routing.js";
import { ensureRuntimeDirectories, loadGatewayEnvironment, loadKorConfig, repositoryKeyForIssue, runtimePaths } from "@kor-code/config";
import { HttpLinearClient, LinearStore } from "@kor-code/linear";
import { GitHubShipping, KorDaemon, readExecutionStatus, readStatus } from "@kor-code/daemon";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController } from "@kor-code/controller";
import { GatewayAdapter, readModelRegistry } from "@kor-code/gateway-adapter";
import { PersistentDecisionAuditLog } from "@kor-code/jev";
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
async function canonicalIssue(reference: string): Promise<{ id: string; identifier: string; title: string; repository: string }> {
  const client = new HttpLinearClient();
  const issue = await client.getIssue(reference);
  const loaded = await loadKorConfig();
  return { id: issue.id, identifier: issue.identifier ?? reference, title: issue.title, repository: repositoryKeyForIssue(issue, loaded.config) };
}

async function status(args: readonly string[]): Promise<number> {
  const selectors = args.filter(arg => arg !== "--json");
  if (selectors.length > 1 || selectors.some(arg => arg.startsWith("-"))) { process.stderr.write("Usage: kor status [--json] [EXECUTION-ID|ISSUE-ID]\n"); return 2; }
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  const maxAgeMs = Math.max(2_000, loaded.config.pollIntervalSeconds * 2_000);
  const reference = selectors[0];
  if (reference) {
    const response = await readExecutionStatus(paths, reference, maxAgeMs);
    print(response, jsonFlag(args));
    return response.provenance === "unavailable" ? 1 : 0;
  }
  print(await readStatus(paths, maxAgeMs), jsonFlag(args));
  return 0;
}

async function runIssue(args: readonly string[]): Promise<number> {
  const references = args.filter(arg => arg !== "--json" && arg !== "--dry-run");
  const issueReference = references[0];
  if (references.length !== 1 || !issueReference || issueReference.startsWith("-")) { process.stderr.write("Usage: kor run ISSUE-ID [--dry-run] [--json]\n"); return 2; }
  const json = jsonFlag(args);
  const dryRun = args.includes("--dry-run");
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  const issue = await canonicalIssue(issueReference);
  if (dryRun) {
    print({ issueId: issue.identifier, canonicalIssueId: issue.id, title: issue.title, dryRun: true, intake: loaded.config.intakeLabel, route: loaded.config.defaultRoute, planned: ["enqueue durable assignment", "run isolated session when kor serve is active"] }, json);
    return 0;
  }
  const store = new LinearStore(paths.databaseFile);
  try {
    const assignment = store.enqueue(issue.id, { issueKey: issue.identifier, issueTitle: issue.title });
    print({ schemaVersion: 1, issueId: issue.identifier, canonicalIssueId: issue.id, executionId: assignment.executionId, status: assignment.status, queued: assignment.status === "queued" }, json);
    return 0;
  } finally { store.close(); }
}

async function updateQueue(command: "cancel" | "retry", args: readonly string[]): Promise<number> {
  const references = args.filter(arg => arg !== "--json");
  const issueReference = references[0];
  if (references.length !== 1 || !issueReference || issueReference.startsWith("-")) { process.stderr.write(`Usage: kor ${command} EXECUTION-ID|ISSUE-ID [--json]\n`); return 2; }
  const paths = runtimePaths();
  const store = new LinearStore(paths.databaseFile);
  try {
    const assignment = store.findAssignment(issueReference);
    if (!assignment) throw new Error("execution not found");
    const accepted = command === "cancel" ? store.requestCancel(assignment.issueId) : store.retry(assignment.issueId);
    print({ schemaVersion: 1, issueId: assignment.issueKey ?? assignment.issueId, canonicalIssueId: assignment.issueId, executionId: assignment.executionId, command, accepted }, jsonFlag(args));
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
  if (jevEnabled) {
    const gatewayConfig = await loadGatewayEnvironment(paths.gatewayEnvFile);
    const gatewayAdapter = new GatewayAdapter({ baseUrl: gatewayConfig.baseUrl, ...(gatewayConfig.key ? { apiKey: gatewayConfig.key } : {}) });
    const models = await gatewayAdapter.catalogue({ capabilities: ["streaming", "tool_calls"] });
    if (models.length === 0) throw new Error("--jev requires at least one verified gateway model");
    catalogue = models.map(model => ({ provider: model.provider ?? "unknown", model: model.id, capabilities: Object.entries(model.capabilities).map(([name, supported]) => ({ name, supported })) }));
  }
  const store = new LinearStore(paths.databaseFile);
  const audit = calibration ?? new PersistentDecisionAuditLog({ read: id => store.readDecisionAudit(id), write: (id, at, payload) => store.writeDecisionAudit(id, at, payload), update: (id, at, payload) => store.updateDecisionAudit(id, at, payload) });
  const routing = createServeRouting({ audit, defaultRoute: loaded.config.defaultRoute, models: async () => {
    if (catalogue) return catalogue;
    const registry = await readModelRegistry(paths.modelsFile);
    return registry.models.filter(result => result.verified).map(result => ({ provider: result.model.startsWith("claude-") ? "anthropic" : result.model.split("/")[0] ?? "unknown", model: result.model, capabilities: Object.entries(result.capabilities).map(([name, supported]) => ({ name, supported: supported === true })), ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}), ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}) }));
  } });
  const controller = createController({
    repositories,
    worktrees: new GitWorktreeManager(paths.worktreesDir),
    launcher: new SessionLauncher({ repoRoot: process.cwd(), cockpit: { statusUrl, stateDir: paths.stateDir } }),
    limits: new ConcurrencyLimiter({ total: loaded.config.limits.total, perRepository: loaded.config.limits.perRepository, ...(loaded.config.limits.perProvider ? { perProvider: loaded.config.limits.perProvider } : {}) }),
    defaultRoute: loaded.config.defaultRoute,
    jev: routing.jev,
    ...(calibration ? { calibration: { store: calibration, sampleRate: calibrationConfig.sampleRate, baselineRoute: calibrationConfig.baselineRoute } } : {}),
  });
  const gateway = new GatewayAdapter();
  const verifiedModels = async () => (await readModelRegistry(paths.modelsFile)).models.filter(model => model.verified).map(model => model.model);
  const daemon = new KorDaemon({ paths, config: loaded.config, store, linear: new HttpLinearClient({ writes: {} }), controller, shipping: new GitHubShipping(), port, gateway, verifiedModels, chooseRoute: routing.chooseRoute });
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
    if (command === "cancel" || command === "retry") return await updateQueue(command, args.slice(1));
    if (command === "logs") return await logs(args.slice(1));
    if (command === "calibrate") return await calibrationReport(args.slice(1));
    if (command === "serve") return await serve(args.slice(1));
  } catch (error) {
    process.stderr.write(`FAIL ${command}: ${error instanceof Error ? error.message : "unable to run"}\n`);
    return 1;
  }
  process.stdout.write("Usage: kor serve [--jev] [--no-calibration] [--calibration-rate RATE] [--baseline-model MODEL] | kor calibrate report [--since ISO-8601] [--json] | kor status [--json] [EXECUTION-ID|ISSUE-ID] | kor plan ISSUE-ID | kor run ISSUE-ID [--dry-run] [--json] | kor cancel EXECUTION-ID|ISSUE-ID [--json] | kor retry EXECUTION-ID|ISSUE-ID [--json] | kor logs EXECUTION-ID | kor doctor | kor models list | kor models probe [--family family] [--model model]\n");
  return ["help", "--help", "-h"].includes(command) ? 0 : 2;
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
