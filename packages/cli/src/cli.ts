#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { formatDoctor, runDoctor } from "./doctor.js";

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? "help";
  if (command === "doctor") {
    try {
      const report = await runDoctor();
      process.stdout.write(`${formatDoctor(report)}\n`);
      return report.ok ? 0 : 1;
    } catch (error) {
      process.stdout.write(`FAIL doctor: ${error instanceof Error ? error.message : "unable to run"}\n`);
      return 1;
    }
  }
  process.stdout.write("kor doctor\n  Check Kor credentials, CLIProxyAPI, local tools, and configured repositories.\n");
  return command === "help" ? 0 : 2;
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith("/.bin/kor") : false;
if (entrypoint) process.exitCode = await main();
