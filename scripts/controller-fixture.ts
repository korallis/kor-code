import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SessionLaunch, SessionResult, SessionLauncherLike, Worktree, WorktreeCreateInput, WorktreeManager } from "../packages/controller/src/index.js";
import { ConcurrencyLimiter, RepositoryRegistry, createController } from "../packages/controller/src/index.js";
import { FakeLinearClient } from "../packages/linear/src/index.js";
import { LinearStore } from "../packages/linear/src/store.js";
import { workflowMappingFixture } from "../packages/linear/src/fixture.js";
import { fakeIssue } from "../packages/linear/src/fake.js";

const proofRoot = process.env.KOR_PROOF_DIR;
if (!proofRoot) throw new Error("KOR_PROOF_DIR must point outside the worktree");
const root = resolve(proofRoot);
await mkdir(root, { recursive: true });
const repositoryPath = join(root, "repository");
await mkdir(repositoryPath, { recursive: true });

class FixtureWorktrees implements WorktreeManager {
  readonly created: Worktree[] = [];
  async create(input: WorktreeCreateInput): Promise<Worktree> {
    const worktree = { executionId: input.executionId, issueId: input.issueId, path: join(root, input.executionId), branch: input.branch, repository: input.repository.path };
    await mkdir(worktree.path, { recursive: true }); this.created.push(worktree); return worktree;
  }
  async exists(worktree: Worktree): Promise<boolean> { try { await readFile(join(worktree.path, "issue.txt")); return true; } catch { return false; } }
}

class FixtureLauncher implements SessionLauncherLike {
  async launch(input: SessionLaunch): Promise<SessionResult> {
    await writeFile(join(input.worktreePath, "issue.txt"), input.execution.issueId, "utf8");
    await new Promise(resolve => setTimeout(resolve, 25));
    const value = await readFile(join(input.worktreePath, "issue.txt"), "utf8");
    return { exitCode: value === input.execution.issueId ? 0 : 1, events: [{ at: new Date().toISOString(), kind: "exited", value: 0 }], stdout: value, stderr: "" };
  }
}

const first = { ...fakeIssue("00000000-0000-4000-8000-000000000011"), repository: "fixture" };
const second = { ...fakeIssue("00000000-0000-4000-8000-000000000012"), repository: "fixture" };
const client = new FakeLinearClient([first, second]);
const store = new LinearStore(":memory:");
const worktrees = new FixtureWorktrees();
const controller = createController({ repositories: new RepositoryRegistry([{ key: "fixture", path: repositoryPath }]), worktrees, launcher: new FixtureLauncher(), linear: { store, client, workflow: workflowMappingFixture }, limits: new ConcurrencyLimiter({ total: 2, perRepository: 2 }) });
const results = await Promise.all([controller.runIssue(first.id), controller.runIssue(second.id)]);
const paths = new Set(results.map(result => result.worktree.path));
if (paths.size !== 2) throw new Error("Concurrent executions shared a worktree");
for (const result of results) {
  const marker = await readFile(join(result.worktree.path, "issue.txt"), "utf8");
  if (marker !== result.issue.id) throw new Error(`Worktree marker was overwritten for ${result.issue.id}`);
}
const linked = [await client.getIssue(first.id), await client.getIssue(second.id)];
if (linked.some(issue => issue.sessions.length !== 1 || issue.stateType !== "completed")) throw new Error("Linear links were not retained for both executions");
console.log(`Controller fixture: concurrent=2; isolatedWorktrees=2; linearSessions=${linked.map(issue => issue.sessions.length).join(",")}; states=${linked.map(issue => issue.stateType).join(",")}`);
store.close();
