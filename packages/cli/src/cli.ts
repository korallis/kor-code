#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDoctor, runDoctor } from "./doctor.js";
import { runPlan } from "./plan.js";
import { ensureRuntimeDirectories, loadKorConfig, repositoryKeyForIssue, runtimePaths } from "@kor-code/config";
import { HttpLinearClient, LinearStore } from "@kor-code/linear";
import { KorDaemon, readStatus, type RouteChoice } from "@kor-code/daemon";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController } from "@kor-code/controller";
import { GatewayAdapter, readModelRegistry } from "@kor-code/gateway-adapter";
import { JevClient, JevDecisionCore, PersistentDecisionAuditLog, planPreflight } from "@kor-code/jev";

function jsonFlag(args: readonly string[]): boolean { return args.includes("--json"); }
function valueAfter(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function print(value: unknown, json: boolean): void {
  process.stdout.write(`${json ? JSON.stringify(value, null, 2) : typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}
function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
async function canonicalIssue(reference: string): Promise<{ id: string; identifier: string; title: string; repository: string }> {
  if (uuid(reference)) return { id: reference, identifier: reference, title: reference, repository: reference };
  const client = new HttpLinearClient();
  const issue = await client.getIssue(reference);
  const loaded = await loadKorConfig();
  return { id: issue.id, identifier: issue.identifier ?? reference, title: issue.title, repository: repositoryKeyForIssue(issue, loaded.config) };
}

async function status(args: readonly string[]): Promise<number> {
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  print(await readStatus(paths, Math.max(2_000, loaded.config.pollIntervalSeconds * 2_000)), jsonFlag(args));
  return 0;
}

async function runIssue(args: readonly string[]): Promise<number> {
  const issueReference = args.find(arg => !arg.startsWith("-"));
  if (!issueReference) { process.stderr.write("Usage: kor run ISSUE-ID [--dry-run] [--json]\n"); return 2; }
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
    const assignment = store.enqueue(issue.id);
    print({ issueId: issue.identifier, canonicalIssueId: issue.id, executionId: assignment.executionId, status: assignment.status, queued: true }, json);
    return 0;
  } finally { store.close(); }
}

async function updateQueue(command: "cancel" | "retry", args: readonly string[]): Promise<number> {
  const issueReference = args.find(arg => !arg.startsWith("-"));
  if (!issueReference) { process.stderr.write(`Usage: kor ${command} ISSUE-ID [--json]\n`); return 2; }
  const issue = await canonicalIssue(issueReference);
  const paths = runtimePaths();
  const store = new LinearStore(paths.databaseFile);
  try {
    const accepted = command === "cancel" ? store.requestCancel(issue.id) : store.retry(issue.id);
    print({ issueId: issue.identifier, canonicalIssueId: issue.id, command, accepted }, jsonFlag(args));
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
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535 || port === 8317) throw new Error("--port must be a valid non-8317 TCP port");
  const statusUrl = `http://127.0.0.1:${port}/status`;
  const repositories = new RepositoryRegistry(Object.entries(loaded.config.repos).map(([key, repository]) => ({ key, path: repository.path, defaultBranch: repository.defaultBranch, allowedTools: repository.toolAllowlist, checks: repository.checks })));
  const controller = createController({
    repositories,
    worktrees: new GitWorktreeManager(paths.worktreesDir),
    launcher: new SessionLauncher({ repoRoot: process.cwd(), cockpit: { statusUrl, stateDir: paths.stateDir } }),
    limits: new ConcurrencyLimiter({ total: loaded.config.limits.total, perRepository: loaded.config.limits.perRepository, ...(loaded.config.limits.perProvider ? { perProvider: loaded.config.limits.perProvider } : {}) }),
    defaultRoute: loaded.config.defaultRoute,
  });
  const gateway = new GatewayAdapter();
  const verifiedModels = async () => (await readModelRegistry(paths.modelsFile)).models.filter(model => model.verified).map(model => model.model);
  let daemon: KorDaemon | undefined;
  const chooseRoute = async ({ executionId, issue }: Parameters<NonNullable<ConstructorParameters<typeof KorDaemon>[0]["chooseRoute"]>>[0]): Promise<RouteChoice> => {
    const store = daemon!.store;
    const audit = new PersistentDecisionAuditLog({ read: id => store.readDecisionAudit(id), write: (id, at, payload) => store.writeDecisionAudit(id, at, payload), update: (id, at, payload) => store.updateDecisionAudit(id, at, payload) });
    const registry = await readModelRegistry(paths.modelsFile);
    const verified = registry.models.filter(result => result.verified).map(result => ({ provider: result.model.startsWith("claude-") ? "anthropic" : result.model.split("/")[0] ?? "unknown", model: result.model, capabilities: Object.entries(result.capabilities).map(([name, supported]) => ({ name, supported: supported === true })), ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}), ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}) }));
    const plan = await planPreflight({ executionId, issue: { id: issue.id, title: issue.title, ...(issue.description !== undefined ? { description: issue.description } : {}), acceptanceCriteria: issue.acceptanceCriteria, dependencies: issue.dependencies.map(dependency => ({ id: dependency.id, state: dependency.stateType })) }, verifiedModels: verified, defaultRoute: loaded.config.defaultRoute }, new JevDecisionCore(new JevClient(), audit), audit);
    const { label: _, ...route } = plan.route as typeof plan.route & { label?: string };
    return { route, source: plan.fallback || (plan.route as { label?: string }).label !== "jev" ? "fallback" : "jev" };
  };
  daemon = new KorDaemon({ paths, config: loaded.config, linear: new HttpLinearClient({ writes: {} }), controller, port, gateway, verifiedModels, chooseRoute });
  const handle = await daemon.start();
  process.stdout.write(`kor daemon listening on ${statusUrl}\n`);
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
    if (command === "plan" && args.length === 2) {
      const result = await runPlan(args[1]!);
      process.stdout.write(`${result.output}\n${result.commentWritten ? "linear: clarification comment written" : "linear: no clarification needed"}\n`);
      return result.plan.fallback || result.plan.decisions.some(decision => decision.escalated || decision.kind === "readiness" && decision.choice === "blocked") ? 1 : 0;
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
  process.stdout.write("Usage: kor serve | kor status [--json] | kor plan ISSUE-ID | kor run ISSUE-ID [--dry-run] | kor cancel ISSUE-ID | kor retry ISSUE-ID | kor logs EXECUTION-ID | kor doctor | kor models list | kor models probe [--family family] [--model model]\n");
  return ["help", "--help", "-h"].includes(command) ? 0 : 2;
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
