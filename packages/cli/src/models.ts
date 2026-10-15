import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadGatewayEnvironment } from "@kor-code/config";
import { GatewayAdapter, MODEL_CAPABILITIES, loadAvailableVerifiedModels, isTextModel, modelFamily, modelProvider, readModelRegistry, writeModelRegistry, type ModelProbeResult } from "@kor-code/gateway-adapter";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const sandbox = join(root, "scripts", "sandbox.sh");
const resultSchema = z.object({ type: z.literal("result"), result: z.string(), is_error: z.boolean().optional(), permission_denials: z.array(z.unknown()).optional() });
  function claudeBinDir(): string {
    for (const directory of (process.env.PATH ?? "").split(":")) if (directory && existsSync(join(directory, "claude"))) return directory;
    return "/usr/local/bin";
  }

  function resultLine(stdout: string): string | undefined {
    return resultEvent(stdout)?.result;
  }

  function resultEvent(stdout: string): z.infer<typeof resultSchema> | undefined {
    for (const line of stdout.split(/\r?\n/).reverse()) {
      try {
        const value: unknown = JSON.parse(line);
        const event = resultSchema.safeParse(value);
        if (event.success) return event.data;
      } catch { /* retain the raw line in diagnostics */ }
    }
    return undefined;
  }

  function capability(value: boolean | undefined): string { return value === true ? "pass" : value === false ? "fail" : "absent"; }

  function readyResult(value: string | undefined): boolean {
    try { return z.strictObject({ ready: z.literal(true) }).safeParse(JSON.parse(value?.match(/\{[^{}]*\}(?=\s*(?:```)?\s*$)/)?.[0] ?? "")).success; }
    catch { return false; }
  }

  function runSandbox(args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number, cwd: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("bash", args, { stdio: ["ignore", "pipe", "pipe"], env, cwd, detached: true });
      let stdout = "";
      let stderr = "";
      const killGroup = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try { process.kill(-child.pid, signal); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
      };
      const onInterrupt = () => forwardSignal("SIGINT");
      const onTerminate = () => forwardSignal("SIGTERM");
      const cleanup = () => {
        clearTimeout(timeout);
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onTerminate);
      };
      const forwardSignal = (signal: NodeJS.Signals) => {
        killGroup(signal);
        cleanup();
        process.kill(process.pid, signal);
      };
      const timeout = setTimeout(() => { killGroup("SIGTERM"); reject(new Error(`probe timed out after ${timeoutMs}ms`)); }, timeoutMs);
      process.once("SIGINT", onInterrupt);
      process.once("SIGTERM", onTerminate);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", error => { cleanup(); reject(error); });
      child.on("close", code => { cleanup(); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`probe exited ${code}: ${resultLine(stdout) ?? stderr.slice(0, 500)}`)); });
    });
  }

export async function probeModel(model: string, options: { gateway?: { baseUrl: string; key: string | undefined }; provider?: string | undefined } = {}): Promise<ModelProbeResult> {
    const started = Date.now();
    const scratch = await mkdtemp(join(tmpdir(), "kor-model-probe-"));
    const sessionRoot = await mkdtemp(join(tmpdir(), "kor-model-home-"));
    const marker = join(scratch, "probe.txt");
    const prompt = [
      "Compatibility probe. Use the Write tool to create the requested file with exactly READY, and use Bash to print its contents.",
      `Write ${marker}. Finish with exactly the JSON object {\"ready\":true}.`,
    ].join(" ");
    try {
      if (!isTextModel(model)) throw new Error("Model is for media generation, not chat/coding");
      const gateway = options.gateway ?? await loadGatewayEnvironment();
      const result = await runSandbox([sandbox, "--run", "claude", "-p", prompt, "--model", model, "--effort", "high", "--permission-mode", "acceptEdits", "--allowedTools", "Write", "Bash", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--no-session-persistence", "--setting-sources", ""], { ...process.env, KOR_GATEWAY_URL: gateway.baseUrl, KOR_GATEWAY_KEY: gateway.key ?? "", KOR_SANDBOX_ROOT: sessionRoot, KOR_CLAUDE_BIN_DIR: claudeBinDir(), KOR_SANDBOX_HOME: join(sessionRoot, "home"), KOR_SANDBOX_CONFIG: join(sessionRoot, "config") }, Number(process.env.KOR_MODEL_PROBE_TIMEOUT_MS ?? 180_000), scratch);
      const stream = result.stdout;
      const event = resultEvent(stream);
      const decodedResult = event?.result;
      const hasResult = event !== undefined && event.is_error !== true && !event.permission_denials?.length;
      const wroteMarker = (await readFile(marker, "utf8").catch(() => "")).trim() === "READY";
      const capabilities = {
        streaming: hasResult && /"type"\s*:\s*"stream_event"/.test(stream),
        tool_calls: wroteMarker && /"name"\s*:\s*"Write"/.test(stream) && /"name"\s*:\s*"Bash"/.test(stream),
        // The neutral prompt does not test a lack of thinking; only positive evidence counts.
        ...(/content_block_start.*thinking|"type"\s*:\s*"thinking"/.test(stream) ? { thinking: true } : {}),
        structured_output: readyResult(decodedResult),
      };
      const verified = hasResult && capabilities.streaming && capabilities.tool_calls && capabilities.structured_output;
      const missing = MODEL_CAPABILITIES.filter(name => name !== "thinking" && !capabilities[name]);
      const cost = result.stdout.match(/"total_cost_usd":\s*([0-9.]+)/)?.[1];
      return { model, family: modelFamily(model), provider: modelProvider(model, options.provider), verified, capabilities, ...(verified ? {} : { error: missing.length ? `Missing capabilities: ${missing.join(", ")}; result: ${decodedResult ?? "absent"}` : `Unsuccessful session: ${decodedResult ?? "absent"}` }), ...(cost ? { costUsd: Number(cost) } : {}), durationMs: Date.now() - started, observedAt: new Date().toISOString() };
    } catch (error) {
      return { model, family: modelFamily(model), provider: modelProvider(model, options.provider), verified: false, capabilities: {}, durationMs: Date.now() - started, observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
    } finally { await rm(scratch, { recursive: true, force: true }); await rm(sessionRoot, { recursive: true, force: true }); }
  }


export async function runModels(args: readonly string[]): Promise<number> {
  const command = args[0] ?? "list";
  const value = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const family = value("--family");
  const requested = value("--model");

  function candidates(models: readonly { id: string }[]): string[] {
    return models.map(item => item.id).filter(id => isTextModel(id) && (!family || (modelFamily(id) === family.toLowerCase() || (id.split("/").at(-1) ?? id).toLowerCase().startsWith(family.toLowerCase()))) && (!requested || id === requested));
  }

  if (command === "list") {
    const registry = await readModelRegistry();
    const verified = await loadAvailableVerifiedModels(registry, () => new GatewayAdapter().listModels(), () => console.error("Warning: gateway catalogue unavailable; using saved verified model registry."));
    console.log("MODEL\tFAMILY\tPROVIDER\tCAPABILITIES\tCOST_USD\tDURATION_MS");
    for (const item of verified) console.log(`${item.model}\t${modelFamily(item.model)}\t${item.provider}\t${MODEL_CAPABILITIES.filter(capability => item.capabilities[capability]).join(",")}\t${item.costUsd ?? "-"}\t${item.durationMs ?? "-"}`);
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
  const environment = await loadGatewayEnvironment();
  const results: ModelProbeResult[] = [];
  console.log("MODEL\tSTREAMING\tTOOL_CALLS\tTHINKING\tSTRUCTURED_OUTPUT\tCOST_USD\tDURATION_MS");
  for (const model of ids) {
    const result = await probeModel(model, { gateway: environment, provider: catalogue.data?.find(item => item.id === model)?.owned_by });
    results.push(result);
    console.log(`${model}\t${capability(result.capabilities.streaming)}\t${capability(result.capabilities.tool_calls)}\t${capability(result.capabilities.thinking)}\t${capability(result.capabilities.structured_output)}\t${result.costUsd ?? "-"}\t${result.durationMs ?? "-"}`);
    if (result.error) console.error(`${model}: ${result.error.replace(/[\r\n\t]+/g, " ")}`);
    await writeModelRegistry([...previous, ...results]);
  }

  return 0;
}
