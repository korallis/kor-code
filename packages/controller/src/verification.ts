import { execFile as execFileCallback } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { AcceptanceCondition, Evidence, Execution, RepositoryCheckResult, VerificationAttempt, VerificationReport } from "@kor-code/core";
import { redact, type JevDecisionCore } from "@kor-code/jev";
import { VerificationError, VerificationTracker } from "@kor-code/verification";
import type { SessionResult } from "./launcher.js";

const execFile = promisify(execFileCallback);
const maxDiffCharacters = 200_000;

export interface VerificationOptions {
  /** Probability of yes required from each acceptance Noul. */
  acceptanceThreshold?: number;
  /** At most two repairs after the initial session. */
  maxRepairs?: number;
  checkTimeoutMs?: number;
}
export class ExecutionVerificationError extends VerificationError {
  constructor(readonly report: VerificationReport) {
    const latest = report.attempts.at(-1);
    super(latest?.blockers.join("; ") || "Verification did not pass", latest?.findings ?? []);
    this.name = "VerificationError";
  }
}
export function verificationSettings(options: VerificationOptions = {}) {
  const settings = { acceptanceThreshold: options.acceptanceThreshold ?? 0.7, maxRepairs: options.maxRepairs ?? 2, checkTimeoutMs: options.checkTimeoutMs ?? 600_000 };
  if (!Number.isFinite(settings.acceptanceThreshold) || settings.acceptanceThreshold < 0.5 || settings.acceptanceThreshold > 1) throw new Error("acceptanceThreshold must be between 0.5 and 1");
  if (!Number.isSafeInteger(settings.maxRepairs) || settings.maxRepairs < 0 || settings.maxRepairs > 2) throw new Error("maxRepairs must be an integer between 0 and 2");
  if (!Number.isSafeInteger(settings.checkTimeoutMs) || settings.checkTimeoutMs <= 0) throw new Error("checkTimeoutMs must be positive");
  return settings;
}
function safeText(value: unknown): string { return String(redact(typeof value === "string" ? value : String(value))); }
function failureText(error: unknown): string {
  const output: string[] = [];
  if (error instanceof Error) output.push(error.message);
  if (typeof error === "object" && error !== null) {
    if ("stdout" in error && typeof error.stdout === "string") output.push(error.stdout);
    if ("stderr" in error && typeof error.stderr === "string") output.push(error.stderr);
  }
  return safeText(output.join("\n") || String(error));
}
async function runCheck(command: string, cwd: string, timeout: number): Promise<RepositoryCheckResult> {
  try {
    const result = await execFile("sh", ["-c", command], { cwd, timeout, maxBuffer: 1_048_576 });
    return { command, exitCode: 0, output: safeText([result.stdout, result.stderr].filter(Boolean).join("\n")), status: "pass" };
  } catch (error) {
    const exitCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : null;
    return { command, exitCode, output: failureText(error), status: "fail", ...(exitCode === null ? { note: "Check could not finish successfully (spawn, timeout, signal, or output limit)." } : {}) };
  }
}
async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFile("git", ["-C", cwd, ...args], { timeout: 30_000, maxBuffer: 2_097_152 })).stdout;
}
/** Capture before the first session, so committed session changes remain in evidence. */
export async function verificationBase(cwd: string): Promise<string> { try { return (await git(cwd, ["rev-parse", "HEAD"])).trim(); } catch { return ""; } }
async function collectDiff(cwd: string, base: string): Promise<string> {
  let diff = await git(cwd, ["diff", "--no-ext-diff", "--no-textconv", base, "--"]);
  const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const root = await realpath(cwd);
  for (const file of untracked) {
    const path = await realpath(resolve(cwd, file));
    const fromRoot = relative(root, path);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) throw new Error(`Untracked path escapes worktree: ${file}`);
    const content = await readFile(path, "utf8");
    diff += `\n--- /dev/null\n+++ ${file}\n${content}`;
    if (diff.length > maxDiffCharacters) throw new Error("Repository diff exceeds the verification limit; narrow the change before retrying");
  }
  if (diff.length > maxDiffCharacters) throw new Error("Repository diff exceeds the verification limit; narrow the change before retrying");
  return safeText(diff);
}

export async function verifyAttempt(input: {
  execution: Execution;
  acceptance: readonly AcceptanceCondition[];
  session: SessionResult;
  attempt: number;
  checks: readonly string[];
  baseRevision: string;
  jev?: Pick<JevDecisionCore, "judgeAcceptance">;
  enforceSemantic?: boolean;
  settings: ReturnType<typeof verificationSettings>;
}): Promise<VerificationAttempt> {
  const { execution, acceptance, session, settings } = input;
  const blockers: string[] = [];
  if (session.exitCode !== 0 || session.failed || session.telemetry?.isError || (session.telemetry?.permissionDenials ?? 0) > 0) blockers.push(`Session failed: ${session.failureReasons?.join(", ") || `exit ${session.exitCode}`}`);
  const checks: RepositoryCheckResult[] = [];
  for (const command of input.checks) checks.push(await runCheck(command, execution.worktree, settings.checkTimeoutMs));
  blockers.push(...checks.filter(check => check.status !== "pass").map(check => `Check failed: ${check.command} (exit ${check.exitCode ?? "unavailable"})${check.output ? ` — ${check.output.slice(-2_000)}` : ""}`));
  let diff = "";
  let publication: VerificationAttempt["publication"];
  try {
    if (input.baseRevision) {
      diff = await collectDiff(execution.worktree, input.baseRevision);
      const changed = await git(execution.worktree, ["diff", "--name-only", "--no-renames", "-z", input.baseRevision, "--"]);
      const untracked = await git(execution.worktree, ["ls-files", "--others", "--exclude-standard", "-z"]);
      publication = { baseRevision: input.baseRevision, paths: [...new Set([...changed.split("\0"), ...untracked.split("\0")].filter(Boolean))] };
    }
  }
  catch (error) { blockers.push(`Diff unavailable: ${failureText(error)}`); }
  if (input.enforceSemantic && acceptance.length === 0) blockers.push("Explicit acceptance criteria are required");
  const tracker = new VerificationTracker(acceptance, execution.id);
  const evidence: Evidence[] = [
    ...checks.map((check, index) => ({ id: `check-${execution.id}-${input.attempt}-${index}`, executionId: execution.id, kind: "test" as const, summary: `${check.command}: exit ${check.exitCode ?? "unavailable"}`, source: check.command, status: check.status })),
    { id: `diff-${execution.id}-${input.attempt}`, executionId: execution.id, kind: "git" as const, summary: `Collected worktree diff (${diff.length} characters)`, status: "pass" as const },
  ];
  let judgments: Awaited<ReturnType<JevDecisionCore["judgeAcceptance"]>> = [];
  let judgmentError: string | undefined;
  try {
    if (!input.jev) throw new Error("TypeSafe acceptance judge is not configured");
    judgments = await input.jev.judgeAcceptance({ executionId: execution.id, state: { diff, checks: checks.map(check => ({ ...check })), session: { exitCode: session.exitCode, failed: blockers.length > 0 }, evidenceErrors: blockers }, criteria: acceptance, threshold: settings.acceptanceThreshold });
  } catch (error) {
    if (input.enforceSemantic) { judgmentError = `Jev acceptance unavailable: ${failureText(error)}`; blockers.push(judgmentError); }
  }
  for (const judgment of judgments) {
    evidence.push({ id: `acceptance-${execution.id}-${input.attempt}-${judgment.criterionId}`, executionId: execution.id, kind: "review", acceptanceId: judgment.criterionId, summary: `${judgment.criterionId}: Jev Noul probability ${judgment.probability.toFixed(3)}; threshold ${settings.acceptanceThreshold.toFixed(3)}`, source: "Jev Noul", status: judgment.passed ? "pass" : judgment.probability <= 1 - settings.acceptanceThreshold ? "fail" : "unresolved" });
  }
  tracker.addMany(evidence);
  const findings = tracker.findings().map(finding => ({ ...finding, note: evidence.find(item => item.acceptanceId === finding.conditionId)?.summary ?? judgmentError ?? "No acceptance judgment returned" }));
  if (input.enforceSemantic) blockers.push(...findings.filter(finding => finding.status !== "pass").map(finding => `${finding.conditionId}: ${finding.status} — ${finding.note}`));
  return { attempt: input.attempt, checks, diff, evidence, findings, blockers, ...(publication ? { publication } : {}) };
}
export function repairPrompt(initial: string, attempt: VerificationAttempt): string {
  return `${initial}\n\nRepair attempt ${attempt.attempt + 1}. Resolve these verification failures and preserve the acceptance requirements:\n${attempt.blockers.join("\n")}\n\nAuthoritative check output:\n${attempt.checks.map(check => `${check.command}: exit ${check.exitCode ?? "unavailable"}\n${check.output}`).join("\n").slice(0, 100_000)}\n\nPer-criterion findings:\n${attempt.findings.map(finding => `${finding.conditionId}: ${finding.status} — ${finding.note ?? ""}`).join("\n")}`;
}
