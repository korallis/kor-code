import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { runtimePaths } from "@kor-code/config";
import { processMatches } from "@kor-code/daemon";
import { TrackerStore } from "@kor-code/tracker";

/** Signal only the daemon whose boot ID and start time still own this Kor database. */
export async function stopLocalDaemon(): Promise<void> {
  const paths = runtimePaths();
  try { await access(paths.databaseFile); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const store = new TrackerStore(paths.databaseFile);
  const owner = (() => { try { return store.daemonOwner(); } finally { store.close(); } })();
  if (!owner || !processMatches(owner.process)) return;
  process.kill(owner.process.pid, "SIGTERM");
  const deadline = Date.now() + 20_000;
  while (processMatches(owner.process)) {
    if (Date.now() >= deadline) throw new Error("Kor daemon is still stopping; wait for active work to finish and retry");
    await delay(100);
  }
}
