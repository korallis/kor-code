import { execFile } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { loadKorConfig, runtimePaths } from "@kor-code/config";
import { TrackerStore } from "@kor-code/tracker";
import { missing } from "./install-journal.js";

const exec = promisify(execFile);
const markerSchema = z.object({ executionId: z.string().min(1), issueId: z.string(), path: z.string(), repository: z.string(), branch: z.string().optional() });
const MARKER_SUFFIX = ".kor-worktree.json";

export async function purgeKorWorktrees(): Promise<void> {
  const paths = runtimePaths();
  const files = await readdir(paths.worktreesDir).catch(error => { if (missing(error)) return []; throw error; });
  const markers = files.filter(file => file.endsWith(MARKER_SUFFIX));
  if (!markers.length) return;
  const { config } = await loadKorConfig(paths.configFile, { home: paths.home });
  const repositories = new Set(Object.values(config.repos).map(repository => resolve(repository.path)));
  const store = new TrackerStore(paths.databaseFile);
  const assignments = store.listAssignments();
  store.close();
  const owned = [];
  for (const file of markers) {
    const markerFile = join(paths.worktreesDir, file);
    const marker = markerSchema.parse(JSON.parse(await readFile(markerFile, "utf8")));
    const path = resolve(marker.path);
    const repository = resolve(marker.repository);
    if (file !== `${marker.executionId}${MARKER_SUFFIX}` || path !== join(paths.worktreesDir, marker.executionId) || !repositories.has(repository)) {
      throw new Error("Kor worktree ownership does not match the configured repository; purge stopped");
    }
    const { stdout } = await exec("git", ["-C", repository, "worktree", "list", "--porcelain", "-z"]);
    const registration = stdout.split("\0\0").map(record => record.split("\0")).find(record => record.includes(`worktree ${path}`));
    const registeredBranch = registration?.find(field => field.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
    const expectedBranch = marker.branch ?? assignments.find(assignment => assignment.executionId === marker.executionId && assignment.issueId === marker.issueId)?.manifest?.branch;
    if (registeredBranch && expectedBranch && registeredBranch !== expectedBranch) throw new Error("Kor worktree branch no longer matches its ownership record; purge stopped");
    const branch = expectedBranch ?? registeredBranch;
    if (branch && branch !== "(detached)" && !branch.startsWith("kor/")) throw new Error("Kor worktree is on an unrelated branch; purge stopped");
    owned.push({ markerFile, path, repository, registered: Boolean(registration), branch });
  }
  for (const worktree of owned) {
    if (worktree.registered) await exec("git", ["-C", worktree.repository, "worktree", "remove", "--force", worktree.path]);
    if (worktree.branch?.startsWith("kor/")) {
      const { stdout } = await exec("git", ["-C", worktree.repository, "for-each-ref", "--format=%(refname)", `refs/heads/${worktree.branch}`]);
      if (stdout.trim().split("\n").includes(`refs/heads/${worktree.branch}`)) await exec("git", ["-C", worktree.repository, "branch", "-D", "--", worktree.branch]);
    }
    await rm(worktree.markerFile);
  }
}
