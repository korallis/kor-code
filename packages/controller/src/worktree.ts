import { access, mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import type { Repository } from "./repository.js";
const execFile = promisify(execFileCallback);

export interface Worktree { executionId: string; issueId: string; path: string; branch: string; repository: string }
export interface WorktreeCreateInput { executionId: string; issueId: string; repository: Repository; branch: string }
export interface WorktreeManager { create(input: WorktreeCreateInput): Promise<Worktree>; remove?(worktree: Worktree): Promise<void>; exists?(worktree: Worktree): Promise<boolean> }

export class GitWorktreeManager implements WorktreeManager {
  constructor(private readonly root: string) {}
  async create(input: WorktreeCreateInput): Promise<Worktree> {
    const path = join(resolve(this.root), input.executionId);
    await mkdir(resolve(this.root), { recursive: true, mode: 0o700 });
    const branch = input.branch || `kor/${basename(input.issueId)}`;
    try {
      await execFile("git", ["-C", path, "rev-parse", "--show-toplevel"]);
      const currentBranch = (await execFile("git", ["-C", path, "branch", "--show-current"])).stdout.trim();
      if (currentBranch === branch) return { executionId: input.executionId, issueId: input.issueId, path, branch, repository: input.repository.path };
      throw new Error(`Existing worktree ${path} belongs to branch ${currentBranch}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Existing worktree")) throw error;
      await rm(path, { recursive: true, force: true });
    }
    const branchExists = await execFile("git", ["-C", input.repository.path, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true).catch(() => false);
    const addArgs = branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, input.repository.defaultBranch ?? "HEAD"];
    await execFile("git", ["-C", input.repository.path, ...addArgs]);
    return { executionId: input.executionId, issueId: input.issueId, path, branch, repository: input.repository.path };
  }
  async remove(worktree: Worktree): Promise<void> { await execFile("git", ["-C", worktree.repository, "worktree", "remove", "--force", worktree.path]).catch(() => undefined); }
  async exists(worktree: Worktree): Promise<boolean> { try { await access(worktree.path); await execFile("git", ["-C", worktree.path, "rev-parse", "--show-toplevel"]); return true; } catch { return false; } }
}
