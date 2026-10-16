import { access } from "node:fs/promises";
import type { Execution } from "@kor-code/core";
import { TrackerStore, type AssignmentRecord } from "@kor-code/tracker";
import type { WorktreeManager } from "./worktree.js";
export interface ReconciliationReport { assignments: AssignmentRecord[]; expiredLeases: string[]; resumable: Execution[]; missingWorktrees: string[]; orphanedWorktrees: string[] }
export class RestartReconciler {
  constructor(private readonly store: TrackerStore, private readonly worktrees: WorktreeManager) {}
  async reconcile(): Promise<ReconciliationReport> {
    const assignments = this.store.listAssignments(); const expiredLeases: string[] = []; const resumable: Execution[] = []; const missingWorktrees: string[] = [];
    for (const assignment of assignments) {
      if (assignment.status === "complete") continue;
      if (assignment.manifest) { resumable.push(assignment.manifest); try { await access(assignment.manifest.worktree); } catch { missingWorktrees.push(assignment.issueId); } }
      if (assignment.manifest && assignment.manifest.status === "running" && assignment.manifest.worktree && this.worktrees.exists) {
        const exists = await this.worktrees.exists({ executionId: assignment.executionId, issueId: assignment.issueId, path: assignment.manifest.worktree, branch: assignment.manifest.branch, repository: assignment.manifest.repository });
        if (!exists) missingWorktrees.push(assignment.issueId);
      }
      if (this.store.reclaimExpired(assignment.issueId)) expiredLeases.push(assignment.issueId);
    }
    return { assignments: this.store.listAssignments(), expiredLeases, resumable, missingWorktrees: [...new Set(missingWorktrees)], orphanedWorktrees: [] };
  }
}
