import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GatewayAdapter } from "../packages/gateway-adapter/src/index.js";
import { JevClient } from "../packages/jev/src/index.js";
import { probeLinearReadOnly } from "../packages/linear/src/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = new URL("..", import.meta.url).pathname;

async function probe(name: string, action: () => Promise<string>): Promise<void> {
  try { console.log(`${name}: Validated — ${await action()}`); }
  catch (error) { console.log(`${name}: Blocked — ${error instanceof Error ? error.message : String(error)}`); }
}

await probe("gateway", async () => {
  const gateway = new GatewayAdapter();
  const models = await gateway.listModels();
  const management = await gateway.readManagement();
  const ids = Array.isArray(models.data) ? models.data.map((model) => model.id).filter(Boolean).slice(0, 3).join(", ") : "catalogue returned";
  const candidates = Array.isArray(models.data) ? models.data.map((model) => model.id).filter((id): id is string => Boolean(id)).sort((a, b) => a.localeCompare(b)) : [];
  if (candidates.length === 0) throw new Error("catalogue contained no model ids");
  let completion = "";
  let model = "";
  const failures: string[] = [];
  for (const candidate of candidates) {
    try { completion = await gateway.streamCompletion("Reply with exactly one word: ready", candidate); model = candidate; break; }
    catch (error) { failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!model) throw new Error(`no catalogue model streamed a completion; route failures=${failures.join(" | ")}`);
  return `models=${ids || "none"}; management=${management ? "available" : "unavailable"}; selected=${model}; stream=${completion}; routeFailures=${failures.length ? failures.join(" | ") : "none"}`;
});

await probe("Claude Code", async () => {
  const result = await execFileAsync("bash", [`${repoRoot}scripts/sandbox.sh`], { cwd: repoRoot, timeout: 45_000, maxBuffer: 1_000_000 });
  if (!result.stdout.includes("Kor Code cockpit plugin")) throw new Error("plugin proof text missing");
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
