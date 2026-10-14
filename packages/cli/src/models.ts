import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GatewayAdapter, MODEL_CAPABILITIES, readModelRegistry, writeModelRegistry, type ModelProbeResult } from "@kor-code/gateway-adapter";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const sandbox = join(root, "scripts", "sandbox.sh");
  function claudeBinDir(): string {
    for (const directory of (process.env.PATH ?? "").split(":")) if (directory && existsSync(join(directory, "claude"))) return directory;
    return "/usr/local/bin";
  }

  function resultLine(stdout: string): string | undefined {
    return stdout.split(/\r?\n/).filter(line => line.includes('"type":"result"')).at(-1);
  }

  function resultText(stdout: string): string | undefined {
    for (const line of stdout.split(/\r?\n/).reverse()) {
      try {
        const value: unknown = JSON.parse(line);
        if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
        const event = value as { type?: unknown; result?: unknown };
        if (event.type === "result" && typeof event.result === "string") return event.result;
      } catch { /* retain the raw line in diagnostics */ }
    }
    return undefined;
  }

  function capability(value: boolean | undefined): string { return value === true ? "pass" : value === false ? "fail" : "absent"; }

  function runSandbox(args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("bash", args, { stdio: ["ignore", "pipe", "pipe"], env });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`probe timed out after ${timeoutMs}ms`)); }, timeoutMs);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", error => { clearTimeout(timeout); reject(error); });
      child.on("close", code => { clearTimeout(timeout); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`probe exited ${code}: ${resultLine(stdout) ?? stderr.slice(0, 500)}`)); });
    });
  }

export async function probeModel(model: string, gateway?: { baseUrl: string; key: string | undefined }): Promise<ModelProbeResult> {
    const started = Date.now();
    const scratch = await mkdtemp(join(tmpdir(), "kor-model-probe-"));
    const sessionRoot = await mkdtemp(join(tmpdir(), "kor-model-home-"));
    const marker = join(scratch, "probe.txt");
    const prompt = [
      "Compatibility probe. Before acting, use extended thinking to reason through why a write followed by an independent read proves tool execution, while a model's claimed success does not. Then use the Write tool to create the requested file with exactly READY, and use Bash to print its contents.",
      `Write ${marker}. Finish with exactly the JSON object {\"ready\":true}.`,
    ].join(" ");
    try {
      const result = await runSandbox([sandbox, "--run", "claude", "-p", prompt, "--model", model, "--effort", "high", "--permission-mode", "acceptEdits", "--allowedTools", "Write", "Bash", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--no-session-persistence", "--setting-sources", ""], { ...process.env, ...(gateway ? { KOR_GATEWAY_URL: gateway.baseUrl, KOR_GATEWAY_KEY: gateway.key ?? "" } : {}), KOR_SANDBOX_ROOT: sessionRoot, KOR_CLAUDE_BIN_DIR: claudeBinDir(), KOR_SANDBOX_HOME: join(sessionRoot, "home"), KOR_SANDBOX_CONFIG: join(sessionRoot, "config") }, Number(process.env.KOR_MODEL_PROBE_TIMEOUT_MS ?? 180_000));
      const stream = result.stdout;
      const decodedResult = resultText(stream);
      const hasResult = decodedResult !== undefined;
      const wroteMarker = (await readFile(marker, "utf8").catch(() => "")).trim() === "READY";
      const capabilities = {
        streaming: hasResult,
        tool_calls: wroteMarker && /tool_use|"name"\s*:\s*"(?:Write|Bash)"/.test(stream),
        thinking: /content_block_start.*thinking|"type"\s*:\s*"thinking"/.test(stream),
        structured_output: decodedResult !== undefined && /[\"]ready[\"]\s*:\s*true/.test(decodedResult),
      };
      const verified = Object.values(capabilities).every(Boolean);
      const cost = result.stdout.match(/"total_cost_usd":\s*([0-9.]+)/)?.[1];
      return { model, family: model.split("-")[0] ?? "unknown", verified, capabilities, ...(verified ? {} : { error: resultLine(result.stdout) ?? result.stderr.slice(0, 500) }), ...(cost ? { costUsd: Number(cost) } : {}), durationMs: Date.now() - started, observedAt: new Date().toISOString() };
    } catch (error) {
      return { model, family: model.split("-")[0] ?? "unknown", verified: false, capabilities: {}, durationMs: Date.now() - started, observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
    } finally { await rm(scratch, { recursive: true, force: true }); await rm(sessionRoot, { recursive: true, force: true }); }
  }


export async function runModels(args: readonly string[]): Promise<number> {
  const command = args[0] ?? "list";
  const value = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const family = value("--family");
  const requested = value("--model");

  function candidates(models: readonly { id: string }[]): string[] {
    return models.map(item => item.id).filter(id => (!family || id.toLowerCase().startsWith(`${family.toLowerCase()}-`)) && (!requested || id === requested));
  }

  if (command === "list") {
    const registry = await readModelRegistry();
    const verified = new Set(registry.models.filter(item => item.verified).map(item => item.model));
    console.log("MODEL\tFAMILY\tCAPABILITIES\tCOST_USD\tDURATION_MS");
    for (const item of registry.models.filter(item => verified.has(item.model))) console.log(`${item.model}\t${item.family}\t${MODEL_CAPABILITIES.filter(capability => item.capabilities[capability]).join(",")}\t${item.costUsd ?? "-"}\t${item.durationMs ?? "-"}`);
    return 0;
  }
  if (command !== "probe") throw new Error("Usage: kor models list | kor models probe [--family family] [--model model]");
  const gateway = new GatewayAdapter();
  const catalogue = await gateway.listModels();
  const ids = candidates(catalogue.data ?? []);
  if (ids.length === 0) throw new Error("No models matched the probe selection");
  if (args.includes("--dry-run")) {
    console.log(`models=${ids.length}; estimated_cost_usd=unknown; estimated_duration=one sandbox session per model`);
    for (const id of ids) console.log(id);
    return 0;
  }
  const previous = (await readModelRegistry()).models.filter(item => !ids.includes(item.model));
  const results: ModelProbeResult[] = [];
  console.log("MODEL\tSTREAMING\tTOOL_CALLS\tTHINKING\tSTRUCTURED_OUTPUT\tCOST_USD\tDURATION_MS");
  for (const model of ids) {
    const result = await probeModel(model);
    results.push(result);
    console.log(`${model}\t${capability(result.capabilities.streaming)}\t${capability(result.capabilities.tool_calls)}\t${capability(result.capabilities.thinking)}\t${capability(result.capabilities.structured_output)}\t${result.costUsd ?? "-"}\t${result.durationMs ?? "-"}`);
  }
  await writeModelRegistry([...previous, ...results]);

  return 0;
}
