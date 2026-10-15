#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { formatDoctor, runDoctor } from "./doctor.js";
import { runPlan } from "./plan.js";
import { linearLintUsage, runLinearLint } from "./linear.js";
import { installKor, uninstallKor, type InstallScope } from "./install.js";
import { runModels, probeModel } from "./models.js";
import { openUi, daemonQueueAction } from "./ui.js";
import { createServeRouting } from "./serve-routing.js";
import { ensureRuntimeDirectories, loadGatewayEnvironment, loadKorConfig, repositoryKeyForIssue, runtimePaths, type KorConfig } from "@kor-code/config";
import { HttpLinearClient, LinearStore, attachLinearImage } from "@kor-code/linear";
import { GitHubShipping, KorDaemon, MissionServices, processMatches, readExecutionStatus, readStatus, type DaemonOptions } from "@kor-code/daemon";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController, type Controller } from "@kor-code/controller";
import { readModelRegistry, writeModelRegistry } from "@kor-code/gateway-adapter";
import { PersistentDecisionAuditLog } from "@kor-code/jev";
import { CalibrationStore, buildReport, formatReport } from "@kor-code/calibration";
import type { CatalogueModel, KorCliError } from "@kor-code/core";
import { runSkillsInstall, SkillsUsageError, SKILLS_INSTALL_USAGE } from "./skills-install.js";
import { formatSkillLint, lintSkills } from "./skills-lint.js";
import { buildSkillsCatalogue, formatSkillsCatalogue, writeSkillsCatalogue } from "./skills-catalogue.js";
import { guardPrivateSkills, importPrivateSkills, initPrivateSkills, privateSkillsPath } from "./skills-private.js";

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
  if (command === "linear attach-image") return "check the PNG, caption, issue identifier and Linear write credentials; rerun identical inputs to resume a partial upload";
  if (command === "linear") return "check the issue or project identifier and Linear credentials; for projects above 100 issues, lint individual issues";
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
  const mission = new MissionServices(runtimePaths());
  await mission.initialize();
  const client = mission.linear();
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
    const assignment = store.enqueue(issue.id, { issueKey: issue.identifier, issueTitle: issue.title, repository: issue.repository });
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
    const owner = store.daemonOwner();
    let accepted: boolean;
    if (owner && processMatches(owner.process)) { await daemonQueueAction({ executionId: assignment.executionId, action: command }); accepted = true; }
    else accepted = command === "cancel" ? store.requestCancel(assignment.issueId) : store.retry(assignment.issueId);
    if (!accepted) throw new CliFailure("not_accepted", `${command} was not accepted for execution ${assignment.executionId}`, command === "cancel" ? "cancel only queued, running, or blocked executions" : "retry only failed, blocked, or canceled executions");
    print({ schemaVersion: 1, issueId: assignment.issueKey ?? assignment.issueId, canonicalIssueId: assignment.issueId, executionId: assignment.executionId, command, accepted }, jsonFlag(args));
    return 0;
  } finally { store.close(); }
}

async function logs(args: readonly string[]): Promise<number> {
  const references = args.filter(arg => arg !== "--json");
  const executionId = references[0];
  if (references.length !== 1 || !executionId || executionId.startsWith("-")) usageFailure("kor logs EXECUTION-ID [--json]");
  const paths = runtimePaths();
  let content = "";
  try { content = await readFile(join(paths.logsDir, basename(executionId) + ".log"), "utf8"); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  print(jsonFlag(args) ? { executionId, content } : content.trimEnd(), jsonFlag(args));
  return 0;
}

async function calibrationReport(args: readonly string[]): Promise<number> {
  if (args[0] !== "report") throw new Error("Usage: kor calibrate report [--since ISO-8601] [--context] [--json]");
  const since = valueAfter(args, "--since");
  if (since !== undefined && !Number.isFinite(Date.parse(since))) throw new Error("--since must be an ISO-8601 timestamp");
  const store = new CalibrationStore(runtimePaths().databaseFile);
  try {
    const report = buildReport(store, since);
    print(jsonFlag(args) ? report : formatReport(report, { context: args.includes("--context") }), false);
    return 0;
  } finally { store.close(); }
}

async function serve(args: readonly string[]): Promise<number> {
  const paths = runtimePaths();
  const loaded = await loadKorConfig(paths.configFile, { home: paths.home });
  await ensureRuntimeDirectories(paths);
  const sourceRoot = fileURLToPath(new URL("../../..", import.meta.url));
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
  const mission: MissionServices = new MissionServices(paths, async model => {
    const result = await probeModel(model, await mission.sessionGateway());
    const registry = await readModelRegistry(paths.modelsFile);
    await writeModelRegistry([...registry.models.filter(item => item.model !== model), result], paths.modelsFile);
    return result.verified;
  });
  await mission.initialize();
  const calibration = calibrationEnabled ? new CalibrationStore(paths.databaseFile) : undefined;
  let catalogue: CatalogueModel[] | undefined;
  if (jevEnabled) {
    const gatewayAdapter = await mission.gateway();
    const models = await gatewayAdapter.catalogue({ capabilities: ["streaming", "tool_calls"] });
    if (models.length === 0) throw new Error("--jev requires at least one verified gateway model");
    catalogue = models.map(model => ({ provider: model.provider ?? "unknown", model: model.id, capabilities: Object.entries(model.capabilities).map(([name, supported]) => ({ name, supported })) }));
  }
  const store = new LinearStore(paths.databaseFile);
  const audit = calibration ?? new PersistentDecisionAuditLog({ read: id => store.readDecisionAudit(id), write: (id, at, payload) => store.writeDecisionAudit(id, at, payload), update: (id, at, payload) => store.updateDecisionAudit(id, at, payload) });
  const runtime = (config: KorConfig): { controller: Controller; chooseRoute: NonNullable<DaemonOptions["chooseRoute"]> } => {
    const repositories = new RepositoryRegistry(Object.entries(config.repos).map(([key, repository]) => ({ key, path: repository.path, defaultBranch: repository.defaultBranch, allowedTools: repository.toolAllowlist, checks: repository.checks, ...(repository.tools ? { tools: repository.tools } : {}) })));
    const routing = createServeRouting({ audit, defaultRoute: config.defaultRoute, client: { evaluate: (state, questions) => mission.jev().evaluate(state, questions) }, models: async () => {
      if (catalogue) return catalogue;
      const registry = await readModelRegistry(paths.modelsFile);
      return registry.models.filter(result => result.verified).map(result => ({ provider: result.model.startsWith("claude-") ? "anthropic" : result.model.split("/")[0] ?? "unknown", model: result.model, capabilities: Object.entries(result.capabilities).map(([name, supported]) => ({ name, supported: supported === true })), ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}), ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}) }));
    } });
    const controller = createController({
      repositories,
      reserveAttempt: (executionId, attempt) => store.reserveVerificationAttempt(executionId, attempt),
      onStage: (executionId, stage) => daemon.setStage(executionId, stage),
      onSpend: (executionId, spend) => store.recordSpend(executionId, spend),
      worktrees: new GitWorktreeManager(paths.worktreesDir),
      launcher: new SessionLauncher({ repoRoot: sourceRoot, launchProfile: config.launchProfile, sandboxRoot: paths.sessionsDir, gateway: () => mission.sessionGateway(), cockpit: { statusUrl, stateDir: paths.stateDir }, onOutput: (executionId, channel, text) => daemon.recordOutput(executionId, channel, text) }),
      limits: new ConcurrencyLimiter({ total: config.limits.total, perRepository: config.limits.perRepository, ...(config.limits.perProvider ? { perProvider: config.limits.perProvider } : {}) }),
      defaultRoute: config.defaultRoute,
      jev: routing.jev,
      ...(calibration ? { calibration: { store: calibration, sampleRate: config.calibration.sampleRate, baselineRoute: config.calibration.baselineRoute } } : {}),
    });
    return { controller, chooseRoute: routing.chooseRoute };
  };
  const initial = runtime({ ...loaded.config, calibration: calibrationConfig });
  const gateway = await mission.gateway();
  const verifiedModels = async () => (await readModelRegistry(paths.modelsFile)).models.filter(model => model.verified).map(model => model.model);
  const webRoot = valueAfter(args, "--ui-dir") ?? fileURLToPath(new URL("../../web/dist", import.meta.url));
  const daemon = new KorDaemon({ paths, config: loaded.config, store, linear: mission.linear(), ...initial, shipping: new GitHubShipping((file, args, cwd) => mission.shippingCommand(file, args, cwd)), port, gateway, verifiedModels, webRoot, missionServices: mission, reconfigure: runtime });
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
    if (command === "linear") {
      const imageUsage = 'kor linear attach-image ISSUE FILE --alt "SCREEN ROUTE STATE" [--screen ID] [--json]';
      const usage = `${linearLintUsage} | ${imageUsage}`;
      const linearArgs = cleanArgs.slice(1);
      if (linearArgs.includes("--help") || linearArgs.includes("-h")) {
        print(`Usage: ${usage}\nlint: read-only acceptance, dependency and UI screenshot checks.\nattach-image: uploads a PNG (up to 20 MiB), adds it to Screens and attachments, then verifies the saved bytes. Use --screen ID to replace that screen in place. Requires Linear read/write access.`, false);
        return 0;
      }
      if (linearArgs[0] === "lint") {
        if (linearArgs.filter(arg => arg === "--json").length > 1) usageFailure(linearLintUsage);
        const selectors = linearArgs.filter(arg => arg !== "--json");
        const project = selectors[1] === "--project";
        const reference = selectors[project ? 2 : 1];
        if (selectors[0] !== "lint" || selectors.length !== (project ? 3 : 2) || !reference || reference.startsWith("-") || !project && !/^[A-Z][A-Z0-9]+-[0-9]+$/.test(reference)) usageFailure(linearLintUsage);
        return await runLinearLint(reference, project, jsonFlag(linearArgs));
      }
      if (linearArgs[0] !== "attach-image") usageFailure(usage);
      const [, issue, file, ...flags] = linearArgs;
      let alt: string | undefined;
      let screen: string | undefined;
      for (let index = 0; index < flags.length; index++) {
        const flag = flags[index];
        if (flag === "--json") continue;
        if (flag !== "--alt" && flag !== "--screen") usageFailure(usage);
        const value = flags[++index];
        if (!value || value.startsWith("--")) usageFailure(usage);
        if (flag === "--alt") {
          if (alt !== undefined) usageFailure(usage);
          alt = value;
        } else {
          if (screen !== undefined) usageFailure(usage);
          screen = value;
        }
      }
      if (!issue || issue.startsWith("-") || !file || file.startsWith("-") || !alt) usageFailure(usage);
      const result = await attachLinearImage({ issue, file, alt, ...(screen !== undefined ? { screen } : {}) });
      print(jsonFlag(linearArgs) ? result : `${result.issue}: image verified (${result.bytes} bytes, sha256 ${result.sha256})`, jsonFlag(linearArgs));
      return 0;
    }
    if (command === "skills") {
      const skillArgs = cleanArgs.slice(1);
      const catalogueCommands = ["index", "list", "show", "doctor"];
      const action = skillArgs[0];
      if (action === "init" || action === "import" || action === "guard") {
        const usage = action === "import" ? "kor skills import --from DIRECTORY [--dry-run] [--json]"
          : `kor skills ${action}${action === "guard" ? " [DIRECTORY]" : ""} [--json]`;
        if (skillArgs.includes("--help") || skillArgs.includes("-h")) { print(`Usage: ${usage}`, false); return 0; }
        let from: string | undefined;
        let directory: string | undefined;
        let dryRun = false;
        for (let index = 1; index < skillArgs.length; index++) {
          const arg = skillArgs[index];
          if (arg === "--json") continue;
          if (action === "import" && arg === "--dry-run" && !dryRun) { dryRun = true; continue; }
          if (action === "import" && arg === "--from" && from === undefined) {
            from = skillArgs[++index];
            if (!from || from.startsWith("-")) usageFailure(usage);
          } else if (action === "guard" && arg && !arg.startsWith("-") && directory === undefined) directory = arg;
          else usageFailure(usage);
        }
        const paths = runtimePaths();
        const { config } = await loadKorConfig(paths.configFile, { home: paths.home });
        const privatePath = privateSkillsPath(config, paths);
        if (action === "init") {
          await initPrivateSkills(privatePath);
          print(jsonFlag(skillArgs) ? { schemaVersion: 1, ok: true, path: privatePath } : privatePath, jsonFlag(skillArgs));
          return 0;
        }
        if (action === "import") {
          if (!from) usageFailure(usage);
          const report = await importPrivateSkills({ config, paths, from, dryRun });
          print(jsonFlag(skillArgs) ? report : [
            ...report.skills.map(skill => `${skill.name}: ${skill.status}; suggested visibility ${skill.suggestedVisibility}`),
            ...report.diagnostics.map(item => `${item.severity.toUpperCase()} [${item.rule}] ${item.message}`),
            `${report.ok ? "PASS" : "FAIL"} ${dryRun ? "dry-run" : "import"}: ${report.skills.length} skills, ${report.duplicates} duplicates, ${report.bytes} bytes; ${report.destination}`,
          ].join("\n"), jsonFlag(skillArgs));
          return report.ok ? 0 : 1;
        }
        const report = await guardPrivateSkills({ privatePath, publicPath: directory ?? fileURLToPath(new URL("../../../skills", import.meta.url)) });
        print(jsonFlag(skillArgs) ? report : [
          ...report.diagnostics.map(item => `ERROR [${item.rule}] ${item.file}: ${item.message}`),
          `${report.ok ? "PASS" : "FAIL"} skills guard: ${report.files} public files, ${report.privateNames} private names or deny entries`,
        ].join("\n"), jsonFlag(skillArgs));
        return report.ok ? 0 : 1;
      }
      if (action && catalogueCommands.includes(action)) {
        const usage = `kor skills ${action}${action === "show" ? " NAME" : ""} [--from DIRECTORY]... [--estimate] [--json]`;
        if (skillArgs.includes("--help") || skillArgs.includes("-h")) { print(`Usage: ${usage}`, false); return 0; }
        const from: string[] = [];
        let name: string | undefined;
        for (let index = 1; index < skillArgs.length; index++) {
          const arg = skillArgs[index];
          if (arg === "--from") {
            const directory = skillArgs[++index];
            if (!directory || directory.startsWith("-")) usageFailure(usage);
            from.push(directory);
          } else if (arg === "--json" || arg === "--estimate") continue;
          else if (action === "show" && arg && !arg.startsWith("-") && name === undefined) name = arg;
          else usageFailure(usage);
        }
        if (action === "show" && !name) usageFailure(usage);
        const paths = runtimePaths();
        const { config } = await loadKorConfig(paths.configFile, { home: paths.home });
        const catalogue = await buildSkillsCatalogue({ config, paths, from, estimate: skillArgs.includes("--estimate") });
        if (action === "show") {
          const matches = catalogue.skills.filter(skill => skill.name === name);
          if (matches.length !== 1) throw new CliFailure("skill_unavailable", matches.length ? "skill name has conflicting content" : "skill not found", "run kor skills doctor with the same sources");
          const skill = matches[0];
          const result = { schemaVersion: 1, catalogueHash: catalogue.hash, skill };
          print(jsonFlag(skillArgs) ? result : JSON.stringify(result, null, 2), jsonFlag(skillArgs));
        } else {
          if (action === "index" && catalogue.ok) await writeSkillsCatalogue(catalogue, paths);
          print(jsonFlag(skillArgs) ? catalogue : formatSkillsCatalogue(catalogue), jsonFlag(skillArgs));
        }
        return catalogue.ok ? 0 : 1;
      }
      const usage = `kor skills init [--json] | kor skills import --from DIRECTORY [--dry-run] [--json] | kor skills guard [DIRECTORY] [--json] | kor skills lint [DIRECTORY] [--json] | kor skills index|list|show|doctor [--from DIRECTORY]... [--estimate] [--json] | ${SKILLS_INSTALL_USAGE}`;
      if (skillArgs[0] === "--help" || skillArgs[0] === "-h" || ["lint", "add", "update"].includes(skillArgs[0] ?? "") && skillArgs.includes("--help")) {
        print(`Usage: ${usage}\nLint checks the public tier. Catalogue commands merge bundled, private and configured skills; show requires NAME. --from replaces those sources for a read-only scan. add requires a pinned commit; update defaults to --check across both tiers. No daemon required.`, false);
        return 0;
      }
      if (skillArgs[0] === "add" || skillArgs[0] === "update") {
        try {
          const result = await runSkillsInstall(skillArgs);
          print(jsonFlag(skillArgs) ? result.report : result.output, jsonFlag(skillArgs));
          return result.ok ? 0 : 1;
        } catch (error) { if (error instanceof SkillsUsageError) usageFailure(SKILLS_INSTALL_USAGE); throw error; }
      }
      const directories = skillArgs.slice(1).filter(arg => arg !== "--json");
      if (skillArgs[0] !== "lint" || directories.length > 1 || directories.some(arg => arg.startsWith("-"))) usageFailure(usage);
      const root = directories[0] ?? fileURLToPath(new URL("../../../skills", import.meta.url));
      const report = await lintSkills(root);
      print(jsonFlag(skillArgs) ? report : formatSkillLint(report), jsonFlag(skillArgs));
      return report.ok ? 0 : 1;
    }
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
        process.stdout.write(`${JSON.stringify({ schemaVersion: 1, planId: plan.executionId, ready: !blocked, route: plan.route, fallback: plan.fallback, ...(plan.outage ? { outage: plan.outage } : {}), decisions: plan.decisions.map(decision => ({ kind: decision.kind, choice: decision.choice, confidence: decision.confidence, applied: decision.applied, escalated: decision.escalated, policyChecks: decision.policyChecks, reasons: decision.reasons })), commentWritten: result.commentWritten })}\n`);
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
    if (command === "ui") return await openUi(cleanArgs.slice(1));
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
    const structured = cliError(command === "linear" && cleanArgs[1] === "attach-image" ? "linear attach-image" : command, failure);
    if (jsonFlag(args)) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, error: structured })}\n`);
    else process.stderr.write(`FAIL ${command}: ${structured.message}. Hint: ${structured.hint}\n`);
    if (debug && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    return failure instanceof CliFailure ? failure.exitCode : 1;
  }
  process.stdout.write("Usage: kor linear attach-image ISSUE FILE --alt CAPTION [--screen ID] [--json] | kor skills init [--json] | kor skills import --from DIRECTORY [--dry-run] [--json] | kor skills guard [DIRECTORY] [--json] | kor skills lint [DIRECTORY] [--json] | kor skills index|list|show|doctor [--from DIRECTORY]... [--estimate] [--json] | kor skills add|update --help | kor ui | kor serve [--ui-dir DIST] [--jev] [--no-calibration] [--calibration-rate RATE] [--baseline-model MODEL] | kor calibrate report [--since ISO-8601] [--context] [--json] | kor status [--json] [EXECUTION-ID|ISSUE-ID] | kor linear lint ISSUE-ID [--json] | kor linear lint --project PROJECT-ID [--json] | kor plan ISSUE-ID [--json] | kor run ISSUE-ID [--dry-run] [--json] | kor cancel EXECUTION-ID|ISSUE-ID [--json] | kor retry EXECUTION-ID|ISSUE-ID [--json] | kor logs EXECUTION-ID | kor doctor [--json] | kor install [--pilot CHECKOUT] [--scope local|user] [--no-systemd] | kor uninstall [--purge] | kor models list | kor models probe [--family family] [--model model]\n");
  return 0;
}

const entrypoint = process.argv[1] ? realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) : false;
if (entrypoint) process.exitCode = await main();
