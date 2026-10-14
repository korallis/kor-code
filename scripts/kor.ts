const [group, command, ...args] = process.argv.slice(2);
if (group !== "models" || !command) throw new Error("Usage: kor models list | kor models probe [--family family] [--model model]");
process.argv.splice(2, process.argv.length - 2, command, ...args);
const script = new URL("./models.ts", import.meta.url);
const child = await import(script.href);
void child;
