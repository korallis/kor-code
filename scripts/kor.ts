const [group, command, ...args] = process.argv.slice(2);
if (group === "models" && command) {
  process.argv.splice(2, process.argv.length - 2, command, ...args);
  await import(new URL("./models.ts", import.meta.url).href);
} else {
  const { main } = await import("../packages/cli/src/cli.js");
  process.exitCode = await main(process.argv.slice(2));
}
