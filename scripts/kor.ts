const [group, command, ...args] = process.argv.slice(2);
const originalArgs = process.argv.slice(2);
const debug = originalArgs.includes("--debug");
const json = originalArgs.includes("--json");
try {
  if (group === "models" && command) {
    process.argv.splice(2, process.argv.length - 2, command, ...args.filter(arg => arg !== "--debug"));
    await import(new URL("./models.ts", import.meta.url).href);
  } else {
    const { main } = await import("../packages/cli/src/cli.js");
    process.exitCode = await main(originalArgs);
  }
} catch (error) {
  const message = (error instanceof Error ? error.message : "unable to run command").replace(/[\r\n]+/g, " ").trim() || "unable to run command";
  const commandName = group === "models" ? `models ${command ?? ""}`.trim() : group ?? "help";
  const usage = message.startsWith("Usage:");
  const structured = { schemaVersion: 1, error: { code: usage ? "invalid_arguments" : "command_failed", message, hint: `check the ${commandName} arguments and retry; use --debug for details` } };
  if (json) process.stdout.write(`${JSON.stringify(structured)}\n`);
  else process.stderr.write(`FAIL ${commandName}: ${message}. Hint: ${structured.error.hint}\n`);
  if (debug && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exitCode = usage ? 2 : 1;
}
