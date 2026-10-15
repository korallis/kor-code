import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { readManifest } from "./install-journal.js";
import { z } from "zod";
import { runtimePaths } from "@kor-code/config";
import { LinearStore } from "@kor-code/linear";
import { processMatches } from "@kor-code/daemon";
import { ensureUiToken } from "@kor-code/daemon";

const exec = promisify(execFile);
const addressSchema = z.object({ pid: z.number().int().positive(), url: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash; }) });
async function liveUiUrl(token: string): Promise<string | undefined> {
  try {
    const paths = runtimePaths();
    const { url, pid } = addressSchema.parse(JSON.parse(await readFile(join(paths.stateDir, "ui-address.json"), "utf8")));
    const store = new LinearStore(paths.databaseFile);
    try {
      const owner = store.daemonOwner();
      if (owner?.process.pid !== pid || !processMatches(owner.process)) return undefined;
    } finally { store.close(); }
    const response = await fetch(`${url}api/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1_000), redirect: "error" });
    await response.body?.cancel();
    return response.ok ? url : undefined;
  } catch { return undefined; }
}

async function startUiDaemon(token: string): Promise<string> {
  const paths = runtimePaths();
  const manifest = await readManifest(`${paths.stateDir}-install/manifest.json`);
  const logPath = join(paths.logsDir, "serve.log");
  if (manifest?.phase === "installed" && manifest.systemd) {
    try { await exec("systemctl", ["--user", "start", "kor.service"], { timeout: 20_000 }); }
    catch { throw new Error("Cannot start kor.service; check systemctl --user status kor.service"); }
  } else {
    await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
    const log = await open(logPath, "a", 0o600);
    try {
      const child = spawn(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "serve"], {
        detached: true, stdio: ["ignore", log.fd, log.fd], env: process.env,
      });
      await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.unref();
    } finally { await log.close(); }
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const url = await liveUiUrl(token);
    if (url) return url;
    await delay(200);
  }
  throw new Error(`Kor daemon did not become ready; check ${manifest?.systemd ? "journalctl --user -u kor.service" : logPath} (port 8327 must be free)`);
}

/** The fragment is delivered only to the explicitly launched browser, never stdout. */
export async function openUi(args: readonly string[]): Promise<number> {
  if (args.length) throw new Error("Usage: kor ui");
  const paths = runtimePaths();
  const token = await ensureUiToken(paths);
  const url = await liveUiUrl(token) ?? await startUiDaemon(token);
  const target = `${url}#token=${token}`;
  try {
    const options = { timeout: 10_000 };
    if (process.platform === "darwin") await exec("open", [target], options);
    else if (process.env.WSL_DISTRO_NAME) await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${target}'`], options);
    else await exec("xdg-open", [target], options);
    process.stdout.write("Opened Kor Code Mission Control in your browser.\n");
  } catch {
    process.stdout.write(`Browser did not open. Open ${url} and connect using the token in ${join(paths.stateDir, "ui-token")}.\n`);
  }
  process.stdout.write(`Mission Control: ${url}\n`);
  return 0;
}

/** An active daemon owns cancellation fencing and publication retries. */
export async function daemonQueueAction(input: { executionId: string; action: "cancel" | "retry" }): Promise<void> {
  const paths = runtimePaths();
  const token = await ensureUiToken(paths);
  const url = await liveUiUrl(token);
  if (!url) throw new Error("Kor daemon is not running; start kor serve before changing the queue");
  const response = await fetch(`${url}api/runs/${encodeURIComponent(input.executionId)}/${input.action}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ origin: "CLI" }), signal: AbortSignal.timeout(20_000), redirect: "error",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
    throw new Error(failure.success ? failure.data.error.message : "Daemon refused queue action");
  }
  const accepted = z.object({ schemaVersion: z.literal(1), accepted: z.literal(true), executionId: z.literal(input.executionId) }).safeParse(payload);
  if (!accepted.success) throw new Error("Daemon returned an invalid queue acknowledgement");
}
