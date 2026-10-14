import { readFileSync, readdirSync } from "node:fs";
import type { SessionProcessIdentity } from "@kor-code/core";

function processInfo(pid: number): { state: string; group: number; startTicks: string } | undefined {
  let text: string;
  try { text = readFileSync(`/proc/${pid}/stat`, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error("Cannot inspect session process identity");
  }
  const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
  const state = fields[0]; const group = Number(fields[2]); const startTicks = fields[19];
  if (!state || !Number.isSafeInteger(group) || !startTicks || !/^\d+$/.test(startTicks)) throw new Error("Invalid Linux process identity");
  return { state, group, startTicks };
}
export function captureProcess(pid: number): SessionProcessIdentity {
  const info = processInfo(pid);
  if (!info) throw new Error("Session exited before its identity was recorded");
  return { pid, bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), startTicks: info.startTicks, pgid: info.group };
}
export function processMatches(identity: SessionProcessIdentity): boolean {
  if (readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() !== identity.bootId) return false;
  const info = processInfo(identity.pid);
  return Boolean(info && info.state !== "Z" && info.startTicks === identity.startTicks);
}
export function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error instanceof Error && "code" in error && error.code === "EPERM"; }
}
function livingGroup(pid: number): boolean {
  return readdirSync("/proc").filter(name => /^\d+$/.test(name)).some(name => {
    const info = processInfo(Number(name));
    return info?.group === pid && info.state !== "Z";
  });
}
export function sessionGroupAlive(identity: SessionProcessIdentity): boolean {
  if (readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() !== identity.bootId) return false;
  return identity.pgid !== undefined && identity.pgid > 1 && livingGroup(identity.pgid);
}
/** Kill only an identity-verified session group; never signal a recycled PID. */
export async function stopSession(identity: SessionProcessIdentity): Promise<void> {
  const pgid = identity.pgid;
  if (pgid === undefined || pgid <= 1) return;
  const info = processInfo(identity.pid);
  const bootMatches = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() === identity.bootId;
  const identityMatches = Boolean(info && info.startTicks === identity.startTicks);
  // A live process with a different start tick is a recycled PID. The old
  // group cannot still contain members while its leader PID is occupied by a
  // different process, so never use that process's group as a fallback.
  if (info && info.state !== "Z" && !identityMatches) return;
  const daemonGroup = processInfo(process.pid)?.group;
  if (pgid === daemonGroup) throw new Error("Refusing to signal the daemon process group");
  const groupAlive = bootMatches && livingGroup(pgid);
  if (!identityMatches && !groupAlive) return;
  if (info && info.group !== pgid) throw new Error("Session is not the recorded process group");
  try { process.kill(-pgid, "SIGKILL"); } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
  const deadline = Date.now() + 3_000;
  while (livingGroup(pgid)) {
    if (Date.now() >= deadline) throw new Error("Session process group did not stop");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
