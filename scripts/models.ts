import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { GatewayAdapter, MODEL_CAPABILITIES, readModelRegistry, writeModelRegistry, type ModelProbeResult } from "../packages/gateway-adapter/src/index.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const sandbox = join(root, "scripts", "sandbox.sh");
const args = process.argv.slice(2);
const command = args[0] ?? "list";
const value = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const family = value("--family");
const requested = value("--model");

function candidates(models: readonly { id: string }[]): string[] {
  return models.map(item => item.id).filter(id => (!family || id.toLowerCase().startsWith(`${family.toLowerCase()}-`)) && (!requested || id === requested));
}

async function probeModel(model: string): Promise<ModelProbeResult> {
  const started = Date.now();
  const scratch = await mkdtemp(join(tmpdir(), "kor-model-probe-"));
  const marker = join(scratch, "probe.txt");
  const prompt = [
    "Compatibility probe. Use the Write tool to create the requested file with exactly READY, then use Bash to print its contents.",
    `Write ${marker}. Finish with a JSON object containing {\"ready\":true}.`,
  ].join(" ");
  try {
    const result = await execFileAsync("bash", [sandbox, "--run", "claude", "-p", prompt, "--model", model, "--permission-mode", "acceptEdits", "--allowedTools", "Write", "Bash", "--output-format", "stream-json", "--verbose", "--no-session-persistence"], { timeout: Number(process.env.KOR_MODEL_PROBE_TIMEOUT_MS ?? 180_000), maxBuffer: 8 * 1024 * 1024, env: { ...process.env, KOR_SANDBOX_HOME: join(root, ".sandbox", "model-probe", "home"), KOR_SANDBOX_CONFIG: join(root, ".sandbox", "model-probe", "config") } });
    const output = `${result.stdout}\n${result.stderr}`;
    const verified = result.stdout.includes('"type":"result"') && (await readFile(marker, "utf8").catch(() => "")).trim() === "READY";
    const cost = result.stdout.match(/"total_cost_usd":\s*([0-9.]+)/)?.[1];
    return { model, family: model.split("-")[0] ?? "unknown", verified, capabilities: Object.fromEntries(MODEL_CAPABILITIES.map(capability => [capability, verified])), ...(verified ? {} : { error: output.slice(-500) }), ...(cost ? { costUsd: Number(cost) } : {}), durationMs: Date.now() - started, observedAt: new Date().toISOString() };
  } catch (error) {
    return { model, family: model.split("-")[0] ?? "unknown", verified: false, capabilities: {}, durationMs: Date.now() - started, observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (command === "list") {
  const registry = await readModelRegistry();
  const verified = new Set(registry.models.filter(item => item.verified).map(item => item.model));
  console.log("MODEL\tFAMILY\tCAPABILITIES\tCOST_USD\tDURATION_MS");
  for (const item of registry.models.filter(item => verified.has(item.model))) console.log(`${item.model}\t${item.family}\t${MODEL_CAPABILITIES.filter(capability => item.capabilities[capability]).join(",")}\t${item.costUsd ?? "-"}\t${item.durationMs ?? "-"}`);
  process.exit(0);
}
if (command !== "probe") throw new Error("Usage: kor models list | kor models probe [--family family] [--model model]");
const gateway = new GatewayAdapter();
const catalogue = await gateway.listModels();
const ids = candidates(catalogue.data ?? []);
if (ids.length === 0) throw new Error("No models matched the probe selection");
const previous = (await readModelRegistry()).models.filter(item => !ids.includes(item.model));
const results: ModelProbeResult[] = [];
console.log("MODEL\tSTREAMING\tTOOL_CALLS\tTHINKING\tSTRUCTURED_OUTPUT\tCOST_USD\tDURATION_MS");
for (const model of ids) {
  const result = await probeModel(model);
  results.push(result);
  console.log(`${model}\t${result.capabilities.streaming === true ? "pass" : "fail"}\t${result.capabilities.tool_calls === true ? "pass" : "fail"}\t${result.capabilities.thinking === true ? "pass" : "fail"}\t${result.capabilities.structured_output === true ? "pass" : "fail"}\t${result.costUsd ?? "-"}\t${result.durationMs ?? "-"}`);
}
await writeModelRegistry([...previous, ...results]);
