import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { SessionLauncher, GitWorktreeManager } from "../packages/controller/src/index.js";

const execFile = promisify(execFileCallback);
const root = resolve(process.env.KOR_E2E_DIR ?? `/tmp/kor-e2e-live-${process.pid}`);
const repositoryPath = join(root, "repository");
const worktreesPath = join(root, "worktrees");
const branch = `kor/e2e-${Date.now()}`;
const model = process.env.KOR_E2E_MODEL ?? "claude-haiku-4-5-20251001";
const allowedTools = (process.env.KOR_E2E_ALLOWED_TOOLS ?? "Read,Write,Edit,Bash(git status *),Bash(git add *),Bash(git commit *)")
  .split(",").map(tool => tool.trim()).filter(Boolean);
const expectFailure = process.env.KOR_E2E_EXPECT_FAILURE === "1";
const hasRuntimeKey = Boolean(process.env.KOR_GATEWAY_KEY || process.env.KOR_GATEWAY_KEY_FILE);

if (!hasRuntimeKey) {
  console.log("e2e:live skipped: set KOR_GATEWAY_KEY or KOR_GATEWAY_KEY_FILE at runtime (the value is never printed or committed)");
  process.exit(0);
}

await rm(root, { recursive: true, force: true });
await mkdir(repositoryPath, { recursive: true });
await execFile("git", ["-C", repositoryPath, "init", "-q"]);
await execFile("git", ["-C", repositoryPath, "config", "user.email", "kor-e2e@example.invalid"]);
await execFile("git", ["-C", repositoryPath, "config", "user.name", "Kor E2E"]);
await execFile("git", ["-C", repositoryPath, "commit", "--allow-empty", "-m", "e2e base"]);

const worktrees = new GitWorktreeManager(worktreesPath);
const worktree = await worktrees.create({ executionId: "e2e-live", issueId: "E2E-HELLO", repository: { key: "scratch", path: repositoryPath }, branch });
const launcher = new SessionLauncher({ repoRoot: resolve(process.cwd()), env: {
  ...(process.env.KOR_GATEWAY_KEY ? { KOR_GATEWAY_KEY: process.env.KOR_GATEWAY_KEY } : {}),
  ...(process.env.KOR_GATEWAY_KEY_FILE ? { KOR_GATEWAY_KEY_FILE: process.env.KOR_GATEWAY_KEY_FILE } : {}),
} });
const result = await launcher.launch({
  execution: { id: "e2e-live", issueId: "E2E-HELLO", repository: "scratch", worktree: worktree.path, branch, status: "running", route: { provider: "claude", model, accountPolicy: "fill-first", sessionAffinity: true, reasoningLevel: "medium" } },
  repositoryPath,
  worktreePath: worktree.path,
  route: { provider: "claude", model, accountPolicy: "fill-first", sessionAffinity: true, reasoningLevel: "medium" },
  allowedTools,
  prompt: "Create hello.txt containing exactly hello from Kor Code, then git add hello.txt and commit it on the current branch. Do not modify any other files.",
});
const telemetry = result.telemetry;
const hello = await access(join(worktree.path, "hello.txt")).then(() => true).catch(() => false);
const committed = await execFile("git", ["-C", worktree.path, "status", "--porcelain"]).then(async ({ stdout }) => {
  if (stdout.trim() !== "") return false;
  return execFile("git", ["-C", worktree.path, "log", "--all", "--format=%H", "--", "hello.txt"]).then(({ stdout: history }) => history.trim() !== "").catch(() => false);
}).catch(() => false);
const passed = !result.failed && hello && committed;
console.log(`e2e:live ${passed ? "passed" : "failed"}; branch=${branch}; hello=${hello ? "yes" : "no"}; committed=${committed ? "yes" : "no"}; model=${telemetry?.model ?? model}; cost_usd=${telemetry?.totalCostUsd ?? "unknown"}; duration_ms=${telemetry?.durationMs ?? "unknown"}; permission_denials=${telemetry?.permissionDenials ?? "unknown"}`);
if (result.failureReasons?.length) console.log(`e2e:live failure=${result.failureReasons.join(", ")}`);
if (expectFailure) {
  if (!result.failed || (telemetry?.permissionDenials ?? 0) < 1) throw new Error("Expected a permission denial and failed attempt");
  process.exit(0);
}
if (!passed) throw new Error("Expected hello.txt to be committed on the Kor branch");
