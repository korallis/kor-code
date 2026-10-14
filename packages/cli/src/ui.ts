import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { runtimePaths } from "@kor-code/config";
import { ensureUiToken } from "@kor-code/daemon";

const exec = promisify(execFile);
const addressSchema = z.object({ pid: z.number().int().positive(), url: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash; }) });
/** The fragment is delivered only to the explicitly launched browser, never stdout. */
export async function openUi(args: readonly string[]): Promise<number> {
  if (args.length) throw new Error("Usage: kor ui");
  const paths = runtimePaths();
  const token = await ensureUiToken(paths);
  let url: string;
  try { url = addressSchema.parse(JSON.parse(await readFile(join(paths.stateDir, "ui-address.json"), "utf8"))).url; }
  catch { throw new Error("Kor daemon address unavailable; start kor serve first"); }
  const response = await fetch(`${url}api/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3_000), redirect: "error" });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Kor daemon unavailable; start kor serve first");
  const target = `${url}#token=${token}`;
  try {
    if (process.platform === "darwin") await exec("open", [target]);
    else if (process.env.WSL_DISTRO_NAME) await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${target}'`]);
    else await exec("xdg-open", [target]);
  } catch { throw new Error("Unable to open browser; check the system's default browser association"); }
  process.stdout.write("Opened Kor Code Mission Control in your browser.\n");
  return 0;
}

/** An active daemon owns cancellation fencing and publication retries. */
export async function daemonQueueAction(input: { executionId: string; action: "cancel" | "retry" }): Promise<void> {
  const paths = runtimePaths();
  const address = addressSchema.parse(JSON.parse(await readFile(join(paths.stateDir, "ui-address.json"), "utf8")));
  const token = await ensureUiToken(paths);
  const response = await fetch(`${address.url}api/runs/${encodeURIComponent(input.executionId)}/${input.action}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(20_000), redirect: "error",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
    throw new Error(failure.success ? failure.data.error.message : "Daemon refused queue action");
  }
  const accepted = z.object({ schemaVersion: z.literal(1), accepted: z.literal(true), executionId: z.literal(input.executionId) }).safeParse(payload);
  if (!accepted.success) throw new Error("Daemon returned an invalid queue acknowledgement");
}
