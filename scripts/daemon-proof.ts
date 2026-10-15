import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fakeIssue, FakeLinearClient, type LinearIssue } from "../packages/linear/src/index.js";
import { parseKorConfig, runtimePaths } from "../packages/config/src/index.js";
import { KorDaemon } from "../packages/daemon/src/index.js";
import { captureProcess, processExists, processMatches, stopSession } from "../packages/daemon/src/process.js";
import { sessionGroupAlive } from "../packages/daemon/src/process.js";
import { ConcurrencyLimiter, GitWorktreeManager, RepositoryRegistry, SessionLauncher, createController } from "../packages/controller/src/index.js";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(execFileCallback);

const root = await mkdtemp(join(tmpdir(), "kor-daemon-proof-"));
const paths = runtimePaths({ HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"), XDG_DATA_HOME: join(root, "share") });
const issue: LinearIssue = fakeIssue("LEE-57");
issue.stateType = "unstarted";
issue.labels = ["kor"];
const linear = new FakeLinearClient([issue]);
const config = parseKorConfig({ repos: { LEE: { path: root } }, pollIntervalSeconds: 60, intakeLabel: "kor" }, { home: root });
const first = new KorDaemon({ paths, config, linear, port: 0, pollIntervalMs: 60_000 });
const handle = await first.start();
const address = handle.server.address();
if (!address || typeof address === "string") throw new Error("status server did not bind");
const response = await fetch(`http://127.0.0.1:${address.port}/status`);
const status = await response.json() as { provenance: string; snapshot: { runs: Array<{ issueId: string; status: string }> } };
if (status.provenance !== "live" || status.snapshot.runs[0]?.issueId !== issue.id || status.snapshot.runs[0]?.status !== "queued") throw new Error("poll/status proof failed");

const claim = first.store.claim("proof", 60_000, issue.id);
if (!claim) throw new Error("proof assignment was not claimable");
const child = spawn("sleep", ["30"], { stdio: "ignore", detached: true });
if (!child.pid) throw new Error("proof child did not start");
first.store.setSessionPid(claim, child.pid, captureProcess(child.pid));
const orphanRepository = join(root, "orphan-repository");
const orphan = join(paths.worktreesDir, "orphan-execution");
await mkdir(orphanRepository, { recursive: true, mode: 0o700 });
await execFile("git", ["init", "-q", orphanRepository]);
await writeFile(join(orphanRepository, "README.md"), "orphan\n");
await execFile("git", ["-C", orphanRepository, "add", "README.md"]);
await execFile("git", ["-C", orphanRepository, "-c", "user.name=Kor", "-c", "user.email=kor@example.invalid", "commit", "-qm", "root"]);
await mkdir(paths.worktreesDir, { recursive: true, mode: 0o700 });
await execFile("git", ["-C", orphanRepository, "worktree", "add", "-q", orphan]);
await writeFile(join(paths.worktreesDir, "orphan-execution.kor-worktree.json"), `${JSON.stringify({ executionId: "orphan-execution", path: orphan, repository: orphanRepository })}\n`, { mode: 0o600 });
await handle.stop();

const second = new KorDaemon({ paths, config, linear, port: 0, pollIntervalMs: 60_000 });
const restarted = await second.start();
const recovered = second.status().runs.find(run => run.issueId === issue.id);
if (recovered?.status !== "queued" || recovered.attempts < 1) throw new Error(`restart recovery proof failed: ${JSON.stringify(recovered)}`);
if (second.status().runs.length !== 1) throw new Error("recovery duplicated the assignment");
await restarted.stop();

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("daemon proof timed out");
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
}
const lifecycleRoot = await mkdtemp(join(tmpdir(), "kor-daemon-lifecycle-"));
const lifecyclePaths = runtimePaths({ HOME: lifecycleRoot, XDG_CONFIG_HOME: join(lifecycleRoot, "config"), XDG_STATE_HOME: join(lifecycleRoot, "state"), XDG_DATA_HOME: join(lifecycleRoot, "share") });
const lifecycleIssue = fakeIssue("LEE-58");
lifecycleIssue.stateType = "unstarted";
lifecycleIssue.labels = ["kor"];
const lifecycleLinear = new FakeLinearClient([lifecycleIssue]);
const lifecycleConfig = parseKorConfig({ repos: { LEE: { path: lifecycleRoot } }, pollIntervalSeconds: 60, intakeLabel: "kor" }, { home: lifecycleRoot });
let invocations = 0;
const lifecycleDaemon = new KorDaemon({ paths: lifecyclePaths, config: lifecycleConfig, linear: lifecycleLinear, port: 0, leaseTtlMs: 200, pollIntervalMs: 60_000, runner: async ({ onSpawn }) => {
  invocations += 1;
  const child = spawn("sleep", ["10"], { stdio: "ignore", detached: true });
  if (!child.pid) throw new Error("lifecycle child did not start");
  onSpawn(child.pid);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 800));
} });
await lifecycleDaemon.start();
await waitFor(() => lifecycleDaemon.status().runs.some(run => run.status === "running"));
await waitFor(() => lifecycleDaemon.status().runs.some(run => run.status === "complete"), 2_000);
if (invocations !== 1) throw new Error(`lease renewal duplicated runner: ${invocations}`);
await lifecycleDaemon.stop();

const cancelRoot = await mkdtemp(join(tmpdir(), "kor-daemon-cancel-"));
const cancelPaths = runtimePaths({ HOME: cancelRoot, XDG_CONFIG_HOME: join(cancelRoot, "config"), XDG_STATE_HOME: join(cancelRoot, "state"), XDG_DATA_HOME: join(cancelRoot, "share") });
const cancelIssue = fakeIssue("LEE-59"); cancelIssue.stateType = "unstarted"; cancelIssue.labels = ["kor"];
const cancelLinear = new FakeLinearClient([cancelIssue]);
const cancelConfig = parseKorConfig({ repos: { LEE: { path: cancelRoot } }, pollIntervalSeconds: 60, intakeLabel: "kor" }, { home: cancelRoot });
const queuedDaemon = new KorDaemon({ paths: cancelPaths, config: cancelConfig, linear: cancelLinear, port: 0, pollIntervalMs: 60_000, runner: async () => { throw new Error("queued cancellation should not launch"); } });
queuedDaemon.store.enqueue(cancelIssue.id);
if (!queuedDaemon.cancel(cancelIssue.id) || queuedDaemon.status().runs[0]?.status !== "canceled") throw new Error("queued cancellation was not terminal");
await queuedDaemon.start();
if (queuedDaemon.status().runs[0]?.status !== "canceled") throw new Error("queued cancellation relaunched");
await queuedDaemon.stop();

let canceledInvocations = 0;
const runningDaemon = new KorDaemon({ paths: cancelPaths, config: cancelConfig, linear: cancelLinear, port: 0, leaseTtlMs: 200, pollIntervalMs: 60_000, runner: async ({ onSpawn, signal }) => {
  canceledInvocations += 1;
  const child = spawn("sleep", ["10"], { stdio: "ignore", detached: true });
  if (!child.pid) throw new Error("cancel child did not start");
  onSpawn(child.pid);
  await new Promise(resolvePromise => signal.addEventListener("abort", () => resolvePromise(undefined), { once: true }));
} });
if (!runningDaemon.store.retry(cancelIssue.id)) throw new Error("canceled retry did not requeue");
await runningDaemon.start();
await waitFor(() => runningDaemon.status().runs.some(run => run.status === "running"));
if (!runningDaemon.cancel(cancelIssue.id)) throw new Error("running cancellation was not accepted");
await waitFor(() => runningDaemon.status().runs.some(run => run.status === "canceled"));
if (canceledInvocations !== 1) throw new Error("running cancellation duplicated");
await runningDaemon.stop();

const failureRoot = await mkdtemp(join(tmpdir(), "kor-daemon-failure-"));
const failurePaths = runtimePaths({ HOME: failureRoot, XDG_CONFIG_HOME: join(failureRoot, "config"), XDG_STATE_HOME: join(failureRoot, "state"), XDG_DATA_HOME: join(failureRoot, "share") });
const failureIssue = fakeIssue("LEE-60"); failureIssue.stateType = "unstarted"; failureIssue.labels = ["kor"];
const failureLinear = new FakeLinearClient([failureIssue]);
const failureConfig = parseKorConfig({ repos: { LEE: { path: failureRoot } }, pollIntervalSeconds: 60, intakeLabel: "kor" }, { home: failureRoot });
let failures = 0;
const failureDaemon = new KorDaemon({ paths: failurePaths, config: failureConfig, linear: failureLinear, port: 0, pollIntervalMs: 60_000, runner: async () => { failures += 1; throw new Error("proof failure"); } });
await failureDaemon.start();
await waitFor(() => failureDaemon.status().runs.some(run => run.status === "failed"));
if (failures !== 1 || !failureDaemon.retry(failureIssue.id) || failureDaemon.status().runs[0]?.status !== "queued") throw new Error("failed run did not become retryable");
await failureDaemon.stop();
const recycled = { ...captureProcess(process.pid), startTicks: "0" };
if (processMatches(recycled)) throw new Error("recycled PID identity unexpectedly matched");
await stopSession(recycled);
const unrelated = spawn("sleep", ["30"], { stdio: "ignore", detached: true });
if (!unrelated.pid) throw new Error("unrelated process did not start");
const unrelatedIdentity = captureProcess(unrelated.pid);
await stopSession({ ...unrelatedIdentity, startTicks: "0" });
if (!processExists(unrelated.pid)) throw new Error("recycled process-group leader was killed");
try { process.kill(-unrelated.pid, "SIGKILL"); } catch { /* the proof process owns this disposable group */ }

const controllerRoot = await mkdtemp(join(tmpdir(), "kor-daemon-controller-cancel-"));
const controllerPaths = runtimePaths({ HOME: controllerRoot, XDG_CONFIG_HOME: join(controllerRoot, "config"), XDG_STATE_HOME: join(controllerRoot, "state"), XDG_DATA_HOME: join(controllerRoot, "share") });
const controllerRepo = join(controllerRoot, "repo");
await mkdir(controllerRepo, { recursive: true });
await execFile("git", ["init", "-q", "-b", "main", controllerRepo]);
await writeFile(join(controllerRepo, "README.md"), "controller proof\n");
await execFile("git", ["-C", controllerRepo, "add", "README.md"]);
await execFile("git", ["-C", controllerRepo, "-c", "user.name=Kor", "-c", "user.email=kor@example.invalid", "commit", "-qm", "root"]);
const controllerSandbox = join(controllerRoot, "sandbox.sh");
await writeFile(controllerSandbox, `#!/bin/bash\nif [ -f "${controllerRoot}/hang" ]; then sleep 60 & echo $! > "${controllerRoot}/grandchild.pid"; wait; fi\necho '{"type":"result","is_error":false,"result":"ok","permission_denials":[]}'\n`);
await chmod(controllerSandbox, 0o700);
await writeFile(join(controllerRoot, "hang"), "yes\n");
const controllerIssue = fakeIssue("LEE-61"); controllerIssue.stateType = "unstarted"; controllerIssue.labels = ["kor"]; controllerIssue.repository = "LEE";
const controllerLinear = new FakeLinearClient([controllerIssue]);
const controllerConfig = parseKorConfig({ repos: { LEE: { path: controllerRepo, defaultBranch: "main" } }, pollIntervalSeconds: 60, intakeLabel: "kor" }, { home: controllerRoot });
const controller = createController({ repositories: new RepositoryRegistry([{ key: "LEE", path: controllerRepo, defaultBranch: "main" }]), worktrees: new GitWorktreeManager(controllerPaths.worktreesDir), launcher: new SessionLauncher({ repoRoot: controllerRoot, sandboxScript: controllerSandbox, args: ["claude"] }), limits: new ConcurrencyLimiter({ total: 1, perRepository: 1 }), defaultRoute: controllerConfig.defaultRoute });
const controllerDaemon = new KorDaemon({ paths: controllerPaths, config: controllerConfig, linear: controllerLinear, controller, port: 0, leaseTtlMs: 300, pollIntervalMs: 60_000 });
await controllerDaemon.start();
await waitFor(() => controllerDaemon.status().runs.some(run => run.status === "running" && run.sessionPid !== undefined));
const controllerPid = controllerDaemon.status().runs[0]?.sessionPid;
if (!controllerPid) throw new Error("real controller did not publish a session PID");
const controllerIdentity = captureProcess(controllerPid);
if (!controllerDaemon.cancel(controllerIssue.id)) throw new Error("real controller cancellation was not accepted");
await waitFor(() => controllerDaemon.status().runs.some(run => run.status === "canceled"));
if (sessionGroupAlive(controllerIdentity)) throw new Error("real controller cancellation left a child process alive");
await controllerDaemon.stop();
console.log(`daemon proof passed; picked=${issue.id}; status=live; restart=queued; attempts=${recovered.attempts}; orphan=removed; lease=exclusive; cancel=terminal; failure=retryable; pid-guard=pass; unrelated-group=survived; controller-child=gone`);
