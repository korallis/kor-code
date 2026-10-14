import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { KorPaths } from "@kor-code/config";
import type { KorExecutionStatusResponse, KorStatusResponse, KorStatusSnapshot } from "@kor-code/core";
import { LinearStore } from "@kor-code/linear";
import { processMatches } from "./process.js";

const runSchema = z.object({ executionId: z.string().min(1), issueId: z.string().min(1), status: z.enum(["queued", "ready", "evaluating", "running", "waiting", "verifying", "repairing", "shipping", "review", "blocked", "complete", "failed", "escalated", "canceled"]), attempts: z.number().int().nonnegative(), observedAt: z.string().datetime(), pullRequestUrl: z.string().url().optional(), costUsd: z.number().nonnegative().finite().optional() }).passthrough();
const snapshotSchema = z.object({ schemaVersion: z.literal(1), observedAt: z.string().datetime(), daemon: z.object({ pid: z.number().int().positive(), startedAt: z.string().datetime(), pollIntervalSeconds: z.number().positive() }).passthrough(), runs: z.array(runSchema) }).passthrough();
function parseSnapshot(value: unknown): KorStatusSnapshot {
  return snapshotSchema.parse(value) as KorStatusSnapshot;
}
export async function readSnapshot(paths: KorPaths): Promise<KorStatusSnapshot | undefined> {
  try { return parseSnapshot(JSON.parse(await readFile(join(paths.snapshotsDir, "index.json"), "utf8"))); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw new Error("daemon snapshot is unreadable"); }
}
export async function readStatus(paths: KorPaths, maxAgeMs = 120_000, now = Date.now): Promise<KorStatusResponse> {
  const observedAt = new Date(now()).toISOString();
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) throw new Error("snapshot freshness must be nonnegative");
  try {
    const snapshot = parseSnapshot(JSON.parse(await readFile(join(paths.snapshotsDir, "index.json"), "utf8")));
    const timestamp = Date.parse(snapshot.observedAt);
    const age = now() - timestamp;
    if (!Number.isFinite(timestamp) || age < -5_000) return { schemaVersion: 1, provenance: "unavailable", observedAt, snapshot: null, reason: "snapshot timestamp is invalid" };
    return { schemaVersion: 1, provenance: age <= maxAgeMs ? "live" : "stale", observedAt, snapshot, ...(age > maxAgeMs ? { reason: `snapshot is ${Math.floor(age / 1_000)}s old` } : {}) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { schemaVersion: 1, provenance: "unavailable", observedAt, snapshot: null, reason: "daemon has not published a snapshot" };
    return { schemaVersion: 1, provenance: "unavailable", observedAt, snapshot: null, reason: "daemon snapshot is unreadable" };
  }
}

/** Read the durable assignment even before the daemon's next snapshot publication. */
export async function readExecutionStatus(paths: KorPaths, reference: string, maxAgeMs = 120_000): Promise<KorExecutionStatusResponse> {
  const observedAt = new Date().toISOString();
  try { await access(paths.databaseFile); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return { schemaVersion: 1, provenance: "unavailable", observedAt, run: null, reason: "no execution database" };
  }
  const snapshot = await readStatus(paths, maxAgeMs);
  const store = new LinearStore(paths.databaseFile);
  try {
    const assignment = store.findAssignment(reference);
    if (!assignment) return { schemaVersion: 1, provenance: "unavailable", observedAt, run: null, reason: "execution not found" };
    const published = snapshot.snapshot?.runs.find(run => run.executionId === assignment.executionId);
    const owner = store.daemonOwner();
    const live = owner !== undefined && processMatches(owner.process) && snapshot.provenance === "live" && snapshot.snapshot.daemon.pid === owner.process.pid;
    return {
      schemaVersion: 1, provenance: live ? "live" : "stale", observedAt,
      ...(!live ? { reason: "daemon is not running or its snapshot is unavailable or stale" } : {}),
      run: {
        executionId: assignment.executionId, issueId: assignment.issueId, issueKey: assignment.issueKey ?? null,
        state: assignment.status, attempts: assignment.attempts, cancelRequested: assignment.cancelRequested ?? false,
        pullRequestUrl: published?.pullRequestUrl ?? null,
        needsInput: assignment.status === "blocked" ? { reason: assignment.lastError ?? "Execution is blocked; inspect kor logs before retrying." } : null,
        costUsd: published?.costUsd ?? null,
      },
    };
  } finally { store.close(); }
}
