import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { GatewayAdapter } from "../packages/gateway-adapter/src/index.js";
import { JevClient } from "../packages/jev/src/index.js";
import { probeLinearReadOnly } from "../packages/linear/src/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = new URL("..", import.meta.url).pathname;

async function claudeChecksum(): Promise<string> {
  const path = `${process.env.HOME ?? ""}/.claude`;
  try { await stat(path); } catch { return "absent"; }
  const hash = createHash("sha256");
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk(path);
  files.sort();
  for (const file of files) {
    try { hash.update(file).update(await readFile(file)); } catch { /* Claude may rotate a session file while probing. */ }
  }
  return hash.digest("hex");
}

async function probe(name: string, action: () => Promise<string>): Promise<void> {
  try { console.log(`${name}: Validated — ${await action()}`); }
  catch (error) { console.log(`${name}: Blocked — ${error instanceof Error ? error.message : String(error)}`); }
}

await probe("gateway", async () => {
  const gateway = new GatewayAdapter();
  const models = await gateway.listModels();
  const ids = Array.isArray(models.data) ? models.data.map((model) => model.id).filter(Boolean).slice(0, 3).join(", ") : "catalogue returned";
  const completion = await gateway.streamCompletion();
  return `models=${ids || "none"}; stream=${completion}`;
});

await probe("Claude Code", async () => {
  const before = await claudeChecksum();
  const result = await execFileAsync("bash", [`${repoRoot}scripts/sandbox.sh`], { cwd: repoRoot, timeout: 45_000, maxBuffer: 1_000_000 });
  const after = await claudeChecksum();
  if (before !== after) throw new Error("~/.claude checksum changed");
  if (!result.stdout.includes("Kor Code cockpit plugin loaded")) throw new Error("plugin proof text missing");
  return "sandbox plugin loaded; ~/.claude checksum unchanged";
});

await probe("Jev", async () => {
  const answer = await new JevClient().choice("A foundation probe is running.", "Which label best describes this?", { foundation: "A first implementation probe", unrelated: "A different activity" });
  return `choice=${answer.choice}; confidence=${answer.confidence}`;
});

await probe("Linear", async () => {
  const result = await probeLinearReadOnly();
  return `viewer=${result.viewer}; teams=${result.teams.join(", ")}; workflowStates=${result.workflowStates.length}`;
});
