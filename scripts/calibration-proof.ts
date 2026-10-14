import { mkdir, rm } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { CatalogueModel, Route } from "../packages/core/src/index.js";
import { CalibrationStore, buildReport, formatReport, sampledPair } from "../packages/calibration/src/index.js";
import { JevDecisionCore, type JevQuestion, type JevResponse } from "../packages/jev/src/index.js";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, createController, type SessionLaunch, type SessionResult, type SessionLauncherLike } from "../packages/controller/src/index.js";
import { fakeIssue } from "../packages/linear/src/index.js";

const execFile = promisify(execFileCallback);
const root = resolve(process.env.KOR_CALIBRATION_PROOF_DIR ?? "/tmp/kor-t12-calibration-proof");
const repositoryPath = join(root, "repository");
await rm(root, { recursive: true, force: true });
await mkdir(repositoryPath, { recursive: true });
await execFile("git", ["-C", repositoryPath, "init", "-q", "-b", "main"]);
await execFile("git", ["-C", repositoryPath, "config", "user.email", "calibration-proof@example.invalid"]);
await execFile("git", ["-C", repositoryPath, "config", "user.name", "Calibration Proof"]);
await execFile("git", ["-C", repositoryPath, "commit", "--allow-empty", "-qm", "proof-base"]);

class ProofLauncher implements SessionLauncherLike {
  async launch(_input: SessionLaunch): Promise<SessionResult> {
    return { exitCode: 0, events: [], stdout: "proof", stderr: "", telemetry: { result: "proof", isError: false, permissionDenials: 0, totalCostUsd: 0.04, durationMs: 12, model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } } };
  }
}

const route: Route = { provider: "anthropic", model: "claude-sonnet-5-5", accountPolicy: "fill-first", sessionAffinity: true, reasoningLevel: "medium" };
const catalogue: CatalogueModel[] = [{ provider: route.provider, model: route.model, capabilities: [{ name: "streaming", supported: true }, { name: "tool_calls", supported: true }] }];
const audit = new CalibrationStore(join(root, "state", "kor", "kor.db"));
const jevClient = {
  async evaluate(_state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
    const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      if (question.type === "choice") {
        const candidates = Object.keys(question.criteria);
        const probabilities = Object.fromEntries(candidates.map((candidate, index) => [candidate, index === 0 ? 1 : 0]));
        return [id, { type: "choice" as const, choice: candidates[0]!, confidence: 1, probabilities }];
      }
      if (question.type === "noul") return [id, { type: "noul" as const, noul: 1 }];
      return [id, { type: "score" as const, score: 0, confidence: 1, probabilities: { "0": 1, "1": 0 }, legend: { "0": "low", "1": "high" } }];
    }));
    return { model: "proof", answers };
  },
};
const jev = new JevDecisionCore(jevClient, audit);
const issue = { ...fakeIssue("00000000-0000-4000-8000-000000000021"), repository: "proof" };
const controller = createController({
  repositories: new RepositoryRegistry([{ key: "proof", path: repositoryPath, defaultBranch: "main" }]),
  worktrees: new GitWorktreeManager(join(root, "worktrees")),
  launcher: new ProofLauncher(),
  jev,
  catalogue,
  defaultRoute: route,
  limits: new ConcurrencyLimiter({ total: 1 }),
  calibration: { store: audit, sampleRate: 1, baselineRoute: route },
});
await controller.dispatch({ id: "proof-jev", issueId: issue.id, repository: "proof", worktree: "", branch: "kor/proof", status: "queued", issue });
controller.recordTerminalOutcome("proof-jev", { status: "merged", recordedAt: new Date().toISOString(), source: "calibration-proof.merge-observation" });
const outcomes = audit.outcomes();
if (!sampledPair("proof-jev", 1) || outcomes.length !== 1 || outcomes[0]?.status !== "merged") throw new Error("Calibration caller did not record the terminal Jev outcome");
process.stdout.write("calibration:proof passed; sampled=true; replay=paired; terminal_outcome=recorded\n\n");
process.stdout.write(`${formatReport(buildReport(audit))}\n`);
audit.close();
process.stdout.write(`proof_state=${root}\n`);
