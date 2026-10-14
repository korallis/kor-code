import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { JevQuestion, JevResponse } from "../packages/jev/src/contracts.js";
import { JevDecisionCore } from "../packages/jev/src/index.js";
import { ConcurrencyLimiter, RepositoryRegistry, createController, type SessionLaunch, type SessionResult, type SessionLauncherLike, type Worktree, type WorktreeCreateInput, type WorktreeManager } from "../packages/controller/src/index.js";
import { FakeLinearClient, fakeIssue, LinearStore } from "../packages/linear/src/index.js";
import { workflowMappingFixture } from "../packages/linear/src/fixture.js";

const root = resolve(process.env.KOR_PROOF_DIR ?? `/tmp/kor-t5-verification-${process.pid}`);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

class ProofWorktrees implements WorktreeManager {
  async create(input: WorktreeCreateInput): Promise<Worktree> {
    const path = join(root, input.executionId);
    await mkdir(path, { recursive: true });
    return { executionId: input.executionId, issueId: input.issueId, path, branch: input.branch, repository: input.repository.path };
  }
}

class ProofLauncher implements SessionLauncherLike {
  calls = 0;
  repairEvidenceSeen = false;
  constructor(private readonly repair: boolean) {}
  async launch(input: SessionLaunch): Promise<SessionResult> {
    this.calls += 1;
    if (this.calls > 1) this.repairEvidenceSeen = input.prompt.includes("Check failed:") && input.prompt.includes("deliberately broken test") && input.prompt.includes("acceptance-1");
    if (this.repair && this.calls > 1) await writeFile(join(input.worktreePath, "fixed.txt"), "fixed\n");
    return { exitCode: 0, events: [], stdout: "proof session", stderr: "", telemetry: { result: "ok", isError: false, permissionDenials: 0 } };
  }
}

class ProofJevClient {
  async evaluate(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
    return { model: "proof-jev", answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => question.type === "noul"
      ? [id, { type: "noul" as const, noul: 0.97 }]
      : [id, { type: "choice" as const, choice: Object.keys(question.criteria)[0]!, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(candidate => [candidate, candidate === Object.keys(question.criteria)[0] ? 1 : 0])) }])) };
  }
}

async function runCase(name: string, repair: boolean): Promise<{ output: string; calls: number }> {
  const repositoryPath = join(root, name, "repository");
  await mkdir(repositoryPath, { recursive: true });
  const issue = { ...fakeIssue(`00000000-0000-4000-8000-${repair ? "000000000021" : "000000000022"}`), repository: "proof", description: "# Acceptance\n- the repair marker exists", acceptanceCriteria: ["the repair marker exists"] };
  const client = new FakeLinearClient([issue]);
  const store = new LinearStore(":memory:");
  const launcher = new ProofLauncher(repair);
  const controller = createController({ repositories: new RepositoryRegistry([{ key: "proof", path: repositoryPath, checks: ["sleep 1; test -f fixed.txt || { echo 'deliberately broken test: fixed.txt missing' >&2; exit 1; }"] }]), worktrees: new ProofWorktrees(), launcher, linear: { store, client, workflow: workflowMappingFixture }, jev: new JevDecisionCore(new ProofJevClient()), limits: new ConcurrencyLimiter({ total: 1 }), leaseTtlMs: 500, verificationOptions: { maxRepairs: 2 } });
  let outcome: string;
  try {
    await controller.runIssue(issue.id);
    outcome = "complete";
  } catch (error) {
    if (!(error instanceof Error) || error.constructor.name !== "VerificationError") throw error;
    const findings = "findings" in error && Array.isArray(error.findings) ? error.findings as Array<{ conditionId: string; status: string }> : [];
    outcome = `blocked (${findings.map(finding => `${finding.conditionId}=${finding.status}`).join(", ")})`;
  }
  const linked = await client.getIssue(issue.id);
  const comments = linked.comments.map(comment => comment.body).join("\n");
  store.close();
  if (!launcher.repairEvidenceSeen) throw new Error("Repair prompt omitted failed check output or criterion findings");
  if (!repair && (!comments.includes("Check failed:") || !comments.includes("deliberately broken test") || linked.stateType === "completed")) throw new Error("Blocked Linear issue omitted the check failure or completed");
  return { output: `${name}: ${outcome}; launches=${launcher.calls}; state=${linked.stateType}; findings=${comments.includes("acceptance-1") ? "recorded" : "none"}; repair-evidence=${launcher.repairEvidenceSeen ? "recorded" : "none"}; blocker=${comments.includes("Check failed:") ? "recorded" : "none"}`, calls: launcher.calls };
}

const repaired = await runCase("repair", true);
const stopped = await runCase("broken", false);
console.log(`verification-proof: ${repaired.output}`);
console.log(`verification-proof: ${stopped.output}`);
if (repaired.calls !== 2 || stopped.calls !== 3 || !stopped.output.includes("blocked") || !stopped.output.includes("recorded")) throw new Error("Verification proof did not demonstrate repair and per-criterion blocking");
