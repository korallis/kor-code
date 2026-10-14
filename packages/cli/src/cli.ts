#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { formatDoctor, runDoctor } from "./doctor.js";
import { loadKorConfig, repositoryKeyForIssue } from "@kor-code/config";
import { HttpLinearClient, workflowMapping, startWrites } from "@kor-code/linear";
import { stableId, type LinearWrite } from "@kor-code/linear";

function flag(args: readonly string[], name: string): boolean { return args.includes(name); }
function writeDescription(write: LinearWrite): string {
  if (write.kind === "state") return `state ${write.stateId}`;
  if (write.kind === "comment") return `comment ${write.id} (${write.body})`;
  if (write.kind === "attachment") return `attachment ${write.url}`;
  if (write.kind === "session") return `agent-session ${write.session.id}`;
  if (write.kind === "summary") return `summary ${write.sessionId}`;
  return `activity ${write.id}`;
}

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
  const writes: LinearWrite[] = [
    { kind: "state", issueId: issue.id, stateId: states.queued.id },
    { kind: "comment", id: stableId("kor-progress", `${issue.id}:cancel`), issueId: issue.id, body: `Kor canceled execution for ${issue.id}; state → ${states.queued.name ?? "Todo"}` },
  ];
  process.stdout.write(`Kor cancel ${issue.id}; repository=${repositoryKey}\n`);
  for (const write of writes) { process.stdout.write(`WRITE ${writeDescription(write)}\n`); await client.apply(write); }
  return 0;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? "help";
  if (command === "run" || command === "cancel") {
    try { return command === "run" ? await runLinear(args) : await cancelLinear(args); }
    catch (error) { process.stdout.write(`FAIL ${command}: ${error instanceof Error ? error.message : "unable to run"}\n`); return 1; }
  }
  if (command === "doctor" && args.length === 1) {
    try {
      const report = await runDoctor();
      process.stdout.write(`${formatDoctor(report, Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined)}\n`);
      return report.ok ? 0 : 1;
    } catch (error) {
      process.stdout.write(`FAIL doctor: ${error instanceof Error ? error.message : "unable to run"}\n`);
      return 1;
    }
  }
  process.stdout.write("Usage: kor doctor | kor run LEE-<number> [--dry-run] | kor cancel LEE-<number> | kor models list | kor models probe [--family family] [--model model]\n");
  return ["help", "--help", "-h"].includes(command) ? 0 : 2;
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
