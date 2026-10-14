#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDoctor, runDoctor } from "./doctor.js";
import { runPlan } from "./plan.js";
import { installKor, uninstallKor, type InstallScope } from "./install.js";
import { runModels } from "./models.js";
import { createServeRouting } from "./serve-routing.js";
import { ensureRuntimeDirectories, loadGatewayEnvironment, loadKorConfig, repositoryKeyForIssue, runtimePaths } from "@kor-code/config";
import { HttpLinearClient, LinearStore } from "@kor-code/linear";
import { GitHubShipping, KorDaemon, readExecutionStatus, readStatus } from "@kor-code/daemon";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController } from "@kor-code/controller";
import { GatewayAdapter, readModelRegistry } from "@kor-code/gateway-adapter";
import { PersistentDecisionAuditLog } from "@kor-code/jev";
import { CalibrationStore, buildReport, formatReport } from "@kor-code/calibration";
import type { CatalogueModel, KorCliError } from "@kor-code/core";

class CliFailure extends Error {
  constructor(readonly code: string, message: string, readonly hint: string, readonly exitCode = 1) { super(message); }
}

function usageFailure(usage: string): never {
  throw new CliFailure("invalid_arguments", "invalid command arguments", `use ${usage}`, 2);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "unable to run command";
  return message.replace(/[\r\n]+/g, " ").trim() || "unable to run command";
}

function errorHint(command: string, error: unknown): string {
  if (error instanceof CliFailure) return error.hint;
  if (command === "install") return "check the reported path and `kor install --help`; if recovery is required, run `kor uninstall --purge`";
  if (command === "uninstall") return "save any later edits; restore the reported installed snapshot, then retry `kor uninstall`";
  if (command === "serve") return "check the Kor configuration and daemon state, then retry";
  if (command === "run" || command === "plan") return "check the issue identifier, the Linear credentials, and that config.yaml maps the issue's team or project to a repository, then retry";
  if (command === "status" || command === "cancel" || command === "retry" || command === "logs") return "check the execution ID or issue key, then retry";
  return `run \`kor ${command} --help\` or retry with --debug for details`;
}

function cliError(command: string, error: unknown): KorCliError {
  return { code: error instanceof CliFailure ? error.code : "command_failed", message: errorMessage(error), hint: errorHint(command, error) };
}

function jsonFlag(args: readonly string[]): boolean { return args.includes("--json"); }
function valueAfter(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function installScope(args: readonly string[]): InstallScope {
  const value = valueAfter(args, "--scope");
  if (value === undefined || value === "local" || value === "user") return value ?? "local";
  throw new CliFailure("invalid_arguments", "--scope must be local or user", "use `kor install --pilot CHECKOUT` or `kor install --scope user`", 2);
}
function validateInstallArgs(args: readonly string[]): void {
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!flag || seen.has(flag)) usageFailure("kor install --pilot CHECKOUT [--scope local|user] [--no-systemd] [--json]");
    seen.add(flag);
    if (flag === "--no-systemd" || flag === "--json") continue;
    if (flag !== "--pilot" && flag !== "--scope") throw new CliFailure("invalid_arguments", `unknown install option: ${flag}`, "run `kor install --help`", 2);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new CliFailure("invalid_arguments", `${flag} needs a value`, "run `kor install --help`", 2);
  }
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
  if (selectors.length > 1 || selectors.some(arg => arg.startsWith("-"))) usageFailure("kor status [--json] [EXECUTION-ID|ISSUE-ID]");
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  const maxAgeMs = Math.max(2_000, loaded.config.pollIntervalSeconds * 2_000);
  const reference = selectors[0];
  if (reference) {
    const response = await readExecutionStatus(paths, reference, maxAgeMs);
    if (response.provenance === "unavailable") {
      if (jsonFlag(args)) print(response, true);
      else process.stderr.write(`FAIL status: ${response.reason}. Hint: ${response.error?.hint ?? "check the execution ID or daemon state"}\n`);
      return 1;
    }
    print(response, jsonFlag(args));
    return 0;
  }
  const response = await readStatus(paths, maxAgeMs);
  if (response.provenance === "unavailable") {
    if (jsonFlag(args)) print(response, true);
    else process.stderr.write(`FAIL status: ${response.reason}. Hint: ${response.error?.hint ?? "start the daemon and retry"}\n`);
    return 1;
  }
  print(response, jsonFlag(args));
  return 0;
}

async function runIssue(args: readonly string[]): Promise<number> {
  const references = args.filter(arg => arg !== "--json" && arg !== "--dry-run");
  const issueReference = references[0];
  if (references.length !== 1 || !issueReference || issueReference.startsWith("-")) usageFailure("kor run ISSUE-ID [--dry-run] [--json]");
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
  if (references.length !== 1 || !issueReference || issueReference.startsWith("-")) usageFailure(`kor ${command} EXECUTION-ID|ISSUE-ID [--json]`);
  const paths = runtimePaths();
  const store = new LinearStore(paths.databaseFile);
  try {
    const assignment = store.findAssignment(issueReference);
    if (!assignment) throw new CliFailure("execution_not_found", "execution not found", "check the execution ID, issue ID, or stored issue key");
    const accepted = command === "cancel" ? store.requestCancel(assignment.issueId) : store.retry(assignment.issueId);
    if (!accepted) throw new CliFailure("not_accepted", `${command} was not accepted for execution ${assignment.executionId}`, command === "cancel" ? "cancel only queued, running, or blocked executions" : "retry only failed, blocked, or canceled executions");
    print({ schemaVersion: 1, issueId: assignment.issueKey ?? assignment.issueId, canonicalIssueId: assignment.issueId, executionId: assignment.executionId, command, accepted }, jsonFlag(args));
    return 0;
  } finally { store.close(); }
}

async function logs(args: readonly string[]): Promise<number> {
  const executionId = args.find(arg => !arg.startsWith("-"));
  if (!executionId) usageFailure("kor logs EXECUTION-ID [--json]");
  const paths = runtimePaths();
  let content = "";
  try { content = await readFile(join(paths.logsDir, basename(executionId) + ".log"), "utf8"); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  print(jsonFlag(args) ? { executionId, content } : content.trimEnd(), jsonFlag(args));
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
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535 || port === 8317) throw new CliFailure("invalid_port", "--port must be a valid non-8317 TCP port", "choose an available TCP port between 0 and 65535");
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
  const debug = args.includes("--debug");
  const cleanArgs = args.filter(arg => arg !== "--debug");
  const command = cleanArgs[0] ?? "help";
  try {
    if (command === "doctor") {
      if (cleanArgs.slice(1).some(arg => arg !== "--json")) usageFailure("kor doctor [--json]");
      const report = await runDoctor();
      if (jsonFlag(cleanArgs)) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: report.ok, checks: report.checks })}\n`);
      else {
        process.stdout.write(`${formatDoctor(report, Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined)}\n`);
        if (!report.ok) process.stderr.write("FAIL doctor: one or more checks failed. Hint: fix the reported checks and rerun `kor doctor`\n");
      }
      return report.ok ? 0 : 1;
    }
    if (command === "plan") {
      const planArgs = cleanArgs.slice(1).filter(arg => arg !== "--json");
      if (planArgs.length !== 1 || !planArgs[0] || planArgs[0].startsWith("-")) usageFailure("kor plan ISSUE-ID [--json]");
      const result = await runPlan(planArgs[0]);
      const blocked = result.plan.fallback || result.plan.decisions.some(decision => decision.escalated || decision.kind === "readiness" && decision.choice === "blocked");
      if (jsonFlag(cleanArgs)) {
        const { plan } = result;
        process.stdout.write(`${JSON.stringify({ schemaVersion: 1, planId: plan.executionId, ready: !blocked, route: plan.route, fallback: plan.fallback, ...(plan.outage ? { outage: plan.outage } : {}), decisions: plan.decisions.map(decision => ({ kind: decision.kind, choice: decision.choice, confidence: decision.confidence, applied: decision.applied, escalated: decision.escalated })), commentWritten: result.commentWritten })}\n`);
      } else {
        process.stdout.write(`${result.output}\n${result.commentWritten ? "linear: clarification comment written" : "linear: no clarification needed"}\n`);
        if (blocked) process.stderr.write("FAIL plan: preflight did not produce a ready route. Hint: resolve the reported decisions or provide a healthy Jev response, then retry\n");
      }
      return blocked ? 1 : 0;
    }
    if (command === "status") return await status(cleanArgs.slice(1));
    if (command === "run") return await runIssue(cleanArgs.slice(1));
    if (command === "cancel" || command === "retry") return await updateQueue(command, cleanArgs.slice(1));
    if (command === "logs") return await logs(cleanArgs.slice(1));
    if (command === "calibrate") return await calibrationReport(cleanArgs.slice(1));
    if (command === "serve") return await serve(cleanArgs.slice(1));
    if (command === "models") return await runModels(cleanArgs.slice(1));
    if ((command === "install" || command === "uninstall") && cleanArgs.slice(1).some(arg => arg === "--help" || arg === "-h")) {
      process.stdout.write(command === "install" ? "Usage: kor install --pilot CHECKOUT [--scope local|user] [--no-systemd] [--json]\nLocal scope requires a standalone checkout. User scope defaults --pilot to the source checkout. Build first; configure credentials and repository policy before starting the installed unit.\n" : "Usage: kor uninstall [--purge] [--json]\nRestore the installation manifest. Without --purge, retain Kor data and recovery backups. Run through the source CLI to purge after the link has been removed.\n");
      return 0;
    }
    if (command === "install") {
      validateInstallArgs(cleanArgs.slice(1));
      const pilot = valueAfter(cleanArgs.slice(1), "--pilot");
      const scope = installScope(cleanArgs.slice(1));
      if (scope === "local" && !pilot) usageFailure("kor install --pilot CHECKOUT [--scope local|user] [--no-systemd]");
      const result = await installKor({ scope, ...(pilot ? { pilot } : {}), systemd: !cleanArgs.includes("--no-systemd") });
      print(jsonFlag(cleanArgs) ? result : result.output, jsonFlag(cleanArgs));
      return 0;
    }
    if (command === "uninstall") {
      const flags = cleanArgs.slice(1).filter(arg => arg !== "--json");
      if (flags.length > 1 || flags.some(arg => arg !== "--purge")) usageFailure("kor uninstall [--purge] [--json]");
      const result = await uninstallKor({ purge: cleanArgs.slice(1).includes("--purge") });
      print(jsonFlag(cleanArgs) ? result : result.output, jsonFlag(cleanArgs));
      return 0;
    }
    if (!["help", "--help", "-h"].includes(command)) throw new CliFailure("unknown_command", `unknown command \"${command}\"`, "run `kor --help` to list available commands", 2);
  } catch (error) {
    const failure = (command === "install" || command === "uninstall") && !(error instanceof CliFailure)
      ? new CliFailure(`${command}_failed`, errorMessage(error), errorHint(command, error)) : error;
    const structured = cliError(command, failure);
    if (jsonFlag(args)) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, error: structured })}\n`);
    else process.stderr.write(`FAIL ${command}: ${structured.message}. Hint: ${structured.hint}\n`);
    if (debug && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    return failure instanceof CliFailure ? failure.exitCode : 1;
  }
  process.stdout.write("Usage: kor serve [--jev] [--no-calibration] [--calibration-rate RATE] [--baseline-model MODEL] | kor calibrate report [--since ISO-8601] [--json] | kor status [--json] [EXECUTION-ID|ISSUE-ID] | kor plan ISSUE-ID [--json] | kor run ISSUE-ID [--dry-run] [--json] | kor cancel EXECUTION-ID|ISSUE-ID [--json] | kor retry EXECUTION-ID|ISSUE-ID [--json] | kor logs EXECUTION-ID | kor doctor [--json] | kor install [--pilot CHECKOUT] [--scope local|user] [--no-systemd] | kor uninstall [--purge] | kor models list | kor models probe [--family family] [--model model]\n");
  return 0;
}

const entrypoint = process.argv[1] ? realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) : false;
if (entrypoint) process.exitCode = await main();
