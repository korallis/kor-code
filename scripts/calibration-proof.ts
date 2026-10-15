import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { CatalogueModel } from "../packages/core/src/index.js";
import { CalibrationStore, buildReport, formatReport, sampledPair } from "../packages/calibration/src/index.js";
import { JevClient, JevUnavailableError, type JevQuestion, type JevResponse } from "../packages/jev/src/index.js";
import { GitWorktreeManager, RepositoryRegistry, createController, type SessionLaunch, type SessionResult } from "../packages/controller/src/index.js";
import { fakeIssue, FakeLinearClient, type LinearIssue } from "../packages/linear/src/index.js";
import { parseKorConfig, runtimePaths } from "../packages/config/src/index.js";
import { KorDaemon } from "../packages/daemon/src/index.js";
import { createServeRouting } from "../packages/cli/src/serve-routing.js";

const live = process.argv.includes("--live-jev");
const fallback = process.argv.includes("--fallback");
const execFile = promisify(execFileCallback);
const parent = resolve(process.env.KOR_CALIBRATION_PROOF_DIR ?? "/tmp/kor-t12-calibration-proof");
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, "run-"));
const paths = runtimePaths({ HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"), XDG_DATA_HOME: join(root, "share") });
const repositoryPath = join(root, "repository");
await mkdir(repositoryPath);
await execFile("git", ["-C", repositoryPath, "init", "-q", "-b", "main"]);
await execFile("git", ["-C", repositoryPath, "-c", "user.email=calibration-proof@example.invalid", "-c", "user.name=Calibration Proof", "commit", "--allow-empty", "-qm", "proof-base"]);
const config = parseKorConfig({ repos: { proof: { path: repositoryPath, linearTeam: "LEE", checks: ["test \"$(cat hello.txt)\" = hello"] } }, calibration: { sampleRate: 1 } });
const catalogue: CatalogueModel[] = [{ provider: "anthropic", model: "claude-sonnet-5-5", capabilities: [{ name: "streaming", supported: true }, { name: "tool_calls", supported: true }] }];
const issue: LinearIssue = { ...fakeIssue("LEE-57"), title: "Create hello.txt containing hello", description: "Create a single text file hello.txt containing hello followed by a newline. No dependencies or other changes.", acceptanceCriteria: ["hello.txt contains exactly hello followed by a newline."], dependencies: [], stateType: "unstarted", labels: ["kor"] };
const linear = new FakeLinearClient([issue]);
const audit = new CalibrationStore(paths.databaseFile);
const realClient = new JevClient();
let preflightCalls = 0;
const client = {
  async evaluate(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResponse> {
    if (Object.keys(questions).some(id => id.startsWith("readiness-"))) preflightCalls++;
    if (fallback) throw new JevUnavailableError("Forced proof outage; no external request made");
    if (live) return realClient.evaluate(state, questions);
    const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      if (question.type === "choice") {
        const candidates = Object.keys(question.criteria);
        const choice = candidates[0];
        if (!choice) throw new Error("Proof Choice requires candidates");
        return [id, { type: "choice" as const, choice, confidence: 1, probabilities: Object.fromEntries(candidates.map((candidate, index) => [candidate, index === 0 ? 1 : 0])) }];
      }
      if (question.type === "noul") return [id, { type: "noul" as const, noul: 1 }];
      return [id, { type: "score" as const, score: 0, confidence: 1, probabilities: { "0": 1, "1": 0, "2": 0 }, legend: { "0": "low", "1": "medium", "2": "high" } }];
    }));
    return { model: "proof", answers };
  },
};
// Exactly the routing factory used by kor serve; only Linear and session generation are fixtures.
const routing = createServeRouting({ audit, intakeLabel: config.intakeLabel, defaultRoute: config.defaultRoute, models: async () => catalogue, client });
let primaryAttempts = 0;
const controller = createController({
  repositories: new RepositoryRegistry([{ key: "proof", path: repositoryPath, defaultBranch: "main", checks: config.repos.proof?.checks ?? [] }]),
  worktrees: new GitWorktreeManager(paths.worktreesDir),
  launcher: { async launch(input: SessionLaunch): Promise<SessionResult> {
    assert.equal(input.route?.label, input.execution.id.endsWith("-baseline") && !input.skillsDisabled ? undefined : fallback ? "fallback" : "jev");
    if (!input.execution.id.endsWith("-baseline") && ++primaryAttempts === 1 && !fallback) throw new Error("transient launcher crash");
    await writeFile(join(input.worktreePath, "hello.txt"), "hello\n");
    return { exitCode: 0, events: [], stdout: "proof wrote hello.txt", stderr: "", telemetry: { result: "proof", isError: false, permissionDenials: 0, totalCostUsd: 0.04, durationMs: 12, model: input.route?.model ?? "unknown", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } } };
  } },
  jev: routing.jev, defaultRoute: config.defaultRoute,
  verificationOptions: { maxRepairs: 0 },
  calibration: { store: audit, sampleRate: 1, baselineRoute: config.calibration.baselineRoute },
});
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Calibration daemon proof timed out");
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
}
function daemon() { return new KorDaemon({ paths, config, linear, controller, chooseRoute: routing.chooseRoute, port: 0, pollIntervalMs: 60_000 }); }
let current = daemon();
let handle: Awaited<ReturnType<KorDaemon["start"]>> | undefined;
try {
  handle = await current.start();
  await waitFor(() => current.status().runs.some(run => run.status === (fallback ? "blocked" : "failed")));
  const first = current.status().runs[0];
  assert.ok(first);
  const executionId = first.executionId;
  const decisionId = `route-${executionId}`;
  const decision = audit.explain(decisionId).response;
  assert.equal(audit.metrics()[0]?.decisionId, decisionId, "even interrupted attempts retain their route decision");
  if (!fallback) {
    assert.equal(first.routeSource, "jev");
    assert.equal(audit.outcomes()[0]?.status, "abandoned");
    await handle.stop(); handle = undefined;
    current = daemon();
    assert.equal(current.retry(issue.id), true);
    handle = await current.start();
    await waitFor(() => current.status().runs.some(run => run.status === "complete" || run.status === "blocked" || run.status === "failed"));
    assert.equal(current.status().runs[0]?.status, "complete");
    assert.equal(current.status().runs[0]?.routeSource, "jev");
    assert.equal(audit.outcomes().length, 0, "retry must clear stale abandoned outcome");
    assert.equal(audit.explain(decisionId).observedOutcome, undefined);
    assert.equal(audit.run(executionId)?.route.provider, catalogue[0]?.provider);
    assert.equal(audit.run(executionId)?.route.decisionId, decisionId);
    assert.equal(audit.metrics().filter(metric => metric.executionId === executionId).every(metric => metric.decisionId === decisionId), true);
    assert.equal(sampledPair(executionId, 1), true);
    assert.equal(buildReport(audit).pairedSampleSize, 1);
    // Local stand-in for T6's merge observer; never claims a real PR was merged.
    controller.recordTerminalOutcome(executionId, { status: "merged", recordedAt: new Date().toISOString(), source: "calibration-proof.merge-observation" });
    assert.equal(audit.outcomes()[0]?.status, "merged");
  } else {
    assert.equal(first.routeSource, "fallback");
    assert.equal(audit.run(executionId)?.arm, "fallback");
    assert.equal(audit.run(executionId)?.sampled, false);
    assert.equal(audit.runs().length, 1);
    assert.equal(buildReport(audit).pairedSampleSize, 0);
    assert.equal(audit.outcomes()[0]?.status, "rejected");
  }
  assert.equal(preflightCalls, 1, "retry replays the audit without a second preflight");
  assert.equal(audit.decisions().filter(record => record.response.kind === "route").length, 1);
  assert.ok(audit.explain(decisionId).observedOutcome, "terminal outcome updates preflight audit");
  process.stdout.write(`calibration:proof passed; mode=${fallback ? "forced-fallback" : live ? "live-jev" : "fixture"}; daemon=true; preflight_calls=${preflightCalls}; route=${decision.choice}; confidence=${decision.confidence.toFixed(4)}; arm=${audit.run(executionId)?.arm}; pairs=${buildReport(audit).pairedSampleSize}; retry=${fallback ? "not-needed" : "replayed"}; terminal_outcome=recorded\n\n`);
  process.stdout.write(`${formatReport(buildReport(audit))}\n`);
  process.stdout.write(`proof_state=${root}\nreport_command=XDG_STATE_HOME=${join(root, "state")} pnpm kor calibrate report\n`);
} finally {
  await handle?.stop();
  audit.close();
}
