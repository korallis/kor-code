import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SessionLaunch, SessionResult, SessionLauncherLike, Worktree, WorktreeCreateInput, WorktreeManager } from "../packages/controller/src/index.js";
import { RepositoryRegistry, createController } from "../packages/controller/src/index.js";
import { FakeLinearClient, fakeIssue } from "../packages/linear/src/index.js";
import { workflowMappingFixture } from "../packages/linear/src/fixture.js";
import { LinearStore } from "../packages/linear/src/store.js";
import { VerificationError, VerificationTracker } from "../packages/verification/src/index.js";
import { buildContextManifest } from "../packages/context/src/index.js";

const proofRoot = resolve(process.env.KOR_PROOF_DIR ?? ".kor-proof");
await mkdir(proofRoot, { recursive: true });
const repo = join(proofRoot, "repository");
await mkdir(repo, { recursive: true });
await writeFile(join(repo, "AGENTS.md"), "Rules: never print apiKey=fixture-secret\n", "utf8");
const issue = { ...fakeIssue("00000000-0000-4000-8000-000000000051"), repository: "fixture" };
const client = new FakeLinearClient([issue]);
const store = new LinearStore(":memory:");
class Worktrees implements WorktreeManager {
  async create(input: WorktreeCreateInput): Promise<Worktree> { const path = join(proofRoot, input.executionId); await mkdir(path, { recursive: true }); return { executionId: input.executionId, issueId: input.issueId, path, branch: input.branch, repository: input.repository.path }; }
  async exists(worktree: Worktree): Promise<boolean> { try { await readFile(join(worktree.path, "done")); return true; } catch { return false; } }
}
class Launcher implements SessionLauncherLike {
  async launch(input: SessionLaunch): Promise<SessionResult> { await writeFile(join(input.worktreePath, "done"), "ok"); return { exitCode: 0, events: [], stdout: "", stderr: "" }; }
}
const tracker = new VerificationTracker([{ id: "acceptance-1", description: "reaches complete", required: true }]);
const controller = createController({ repositories: new RepositoryRegistry([{ key: "fixture", path: repo }]), worktrees: new Worktrees(), launcher: new Launcher(), linear: { store, client, workflow: workflowMappingFixture }, verification: tracker });
let blocked = false;
try { await controller.runIssue(issue.id); } catch (error) { blocked = error instanceof VerificationError; }
if (!blocked) throw new Error("execution completed without acceptance evidence");
tracker.addEvidence({ id: "acceptance-proof", kind: "test", summary: "fake Linear acceptance check passed", status: "pass", acceptanceId: "acceptance-1" });
await new Promise(resolveDelay => setTimeout(resolveDelay, 1_100));
await controller.runIssue(issue.id);
const finalIssue = await client.getIssue(issue.id);
if (finalIssue.stateType !== "completed") throw new Error(`fake Linear state was ${finalIssue.stateType}`);
const context = await buildContextManifest({ executionId: "context-proof", repository: "fixture", worktree: repo, issue: "apiKey=fixture-secret", maxCharacters: 10_000 });
if (!context.redacted || context.sources.some(source => source.content.includes("fixture-secret"))) throw new Error("context redaction proof failed");
console.log(`phase5-proof: blockedMissingEvidence=${blocked}; completedWithEvidence=${finalIssue.stateType === "completed"}; contextRules=${context.sources.filter(source => source.purpose === "rule").length}; contextRedacted=${context.redacted}; linearWrites=${client.writes.length}`);
store.close();
