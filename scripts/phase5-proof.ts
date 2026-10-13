import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SessionLaunch, SessionResult, SessionLauncherLike, Worktree, WorktreeCreateInput, WorktreeManager } from "../packages/controller/src/index.js";
import { RepositoryRegistry, createController } from "../packages/controller/src/index.js";
import { FakeLinearClient, LinearStore, fakeIssue } from "../packages/linear/src/index.js";
import { workflowMappingFixture } from "../packages/linear/src/fixture.js";
import { buildContextManifest } from "../packages/context/src/index.js";
import type { AppliedDecision, DecisionRequest } from "../packages/jev/src/index.js";

const proofRoot = resolve(process.env.KOR_PROOF_DIR ?? ".kor-proof");
await mkdir(proofRoot, { recursive: true });
const repo = join(proofRoot, "repository");
await mkdir(repo, { recursive: true });
await writeFile(join(repo, "AGENTS.md"), "Rules: never print apiKey=fixture-secret\n".repeat(20), "utf8");
const issueA = { ...fakeIssue("00000000-0000-4000-8000-000000000051"), repository: "fixture" };
const issueB = { ...fakeIssue("00000000-0000-4000-8000-000000000052"), repository: "fixture", title: "Second fixture issue" };
const client = new FakeLinearClient([issueA, issueB]);
const store = new LinearStore(":memory:");
class Worktrees implements WorktreeManager {
  async create(input: WorktreeCreateInput): Promise<Worktree> { const path = join(proofRoot, input.executionId); await mkdir(path, { recursive: true }); return { executionId: input.executionId, issueId: input.issueId, path, branch: input.branch, repository: input.repository.path }; }
  async exists(worktree: Worktree): Promise<boolean> { try { await readFile(join(worktree.path, "done")); return true; } catch { return false; } }
}
class Launcher implements SessionLauncherLike {
  async launch(input: SessionLaunch): Promise<SessionResult> { await writeFile(join(input.worktreePath, "done"), "ok"); return { exitCode: 0, events: [], stdout: "", stderr: "" }; }
}
const controller = createController({ repositories: new RepositoryRegistry([{ key: "fixture", path: repo }]), worktrees: new Worktrees(), launcher: new Launcher(), linear: { store, client, workflow: workflowMappingFixture } });
let blocked = false;
try { await controller.runIssue(issueA.id); } catch (error) { blocked = error instanceof Error && error.constructor.name === "VerificationError"; }
if (!blocked) throw new Error("execution completed without acceptance evidence");
const blockedA = (store.listAssignments().find(assignment => assignment.issueId === issueA.id));
if (blockedA?.manifest?.status !== "blocked") throw new Error("verification block was not recorded for execution A");
await controller.runIssue(issueB.id, [{ id: "issue-b-evidence", kind: "test", summary: "fixture B acceptance passed", status: "pass", acceptanceId: "acceptance-1" }]);
const afterB = await client.getIssue(issueA.id);
const crossExecutionEvidenceIgnored = afterB.stateType !== "completed";
if (!crossExecutionEvidenceIgnored) throw new Error("evidence from execution B completed execution A");
await new Promise(resolveDelay => setTimeout(resolveDelay, 1_100));
await controller.runIssue(issueA.id, [{ id: "issue-a-evidence", kind: "test", summary: "fixture A acceptance passed", status: "pass", acceptanceId: "acceptance-1" }]);
const finalA = await client.getIssue(issueA.id);
const completedWithOwnEvidence = finalA.stateType === "completed";
if (!completedWithOwnEvidence) throw new Error(`fake Linear state was ${finalA.stateType}`);
let jevPayloadCharacters = 0;
const jev = { async rankContext(request: DecisionRequest): Promise<AppliedDecision> { const state = request.state; jevPayloadCharacters = 0; if (typeof state === "object" && state !== null && !Array.isArray(state)) { if (typeof state.issue === "string") jevPayloadCharacters += state.issue.length; if (Array.isArray(state.sources)) for (const source of state.sources) if (typeof source === "object" && source !== null && !Array.isArray(source) && typeof source.content === "string") jevPayloadCharacters += source.content.length; } return { decisionId: request.decisionId, executionId: request.executionId, kind: "context", question: request.question, inputs: request.inputs, choice: request.candidates[0] ?? "", candidates: request.candidates, confidence: 1, reasons: ["fixture relevance"], evidenceRefs: [], policyChecks: request.policyChecks ?? [], applied: true, escalated: false }; } };
const context = await buildContextManifest({ executionId: "context-proof", repository: "fixture", worktree: repo, issue: "apiKey=fixture-secret", maxCharacters: 100, jev });
if (!context.redacted || context.sources.some(source => source.content.includes("fixture-secret")) || jevPayloadCharacters > 100 || context.droppedSources.length === 0) throw new Error("context bounds, redaction, or dropped-source proof failed");
console.log(`phase5-proof: blockedMissingEvidence=${blocked}; crossExecutionEvidenceIgnored=${crossExecutionEvidenceIgnored}; completedWithOwnEvidence=${completedWithOwnEvidence}; contextRules=${context.sources.filter(source => source.purpose === "rule").length}; contextDropped=${context.droppedSources.length}; jevPayloadCharacters=${jevPayloadCharacters}; contextRedacted=${context.redacted}; linearWrites=${client.writes.length}`);
store.close();
