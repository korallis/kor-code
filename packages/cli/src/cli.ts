#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { formatDoctor, runDoctor } from "./doctor.js";
import { runPlan } from "./plan.js";

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? "help";
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
  if (command === "plan" && args.length === 2) {
    try {
      const result = await runPlan(args[1]!);
      process.stdout.write(`${result.output}\n${result.commentWritten ? "linear: clarification comment written" : "linear: no clarification needed"}\n`);
      return result.plan.fallback || result.plan.decisions.some(decision => decision.escalated || decision.kind === "readiness" && decision.choice === "blocked") ? 1 : 0;
    } catch (error) {
      process.stdout.write(`FAIL plan: ${error instanceof Error ? error.message : "unable to plan"}\n`);
      return 1;
    }
  }
  process.stdout.write("Usage: kor doctor | kor plan LEE-57 | kor models list | kor models probe [--family family] [--model model]\n");
  return ["help", "--help", "-h"].includes(command) ? 0 : 2;
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
