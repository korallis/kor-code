import { randomUUID } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { StringDecoder } from "node:string_decoder";
import type { AcceptanceCondition, Evidence, Execution, RepositoryCheckResult, VerificationAttempt, VerificationReport } from "@kor-code/core";
import { redact, type JevDecisionCore } from "@kor-code/jev";
import { VerificationError, VerificationTracker } from "@kor-code/verification";
import type { SessionResult } from "./launcher.js";

const execFile = promisify(execFileCallback);
const maxDiffTokens = 24_000;
const maxAcceptanceTokens = 30_000;
const estimatedBytesPerToken = 3;
const maxDiffBytes = Math.floor(maxDiffTokens * estimatedBytesPerToken);
const maxCheckOutputCharacters = 4_000;
const maxRepairEvidenceBytes = 16_000;
const truncationMarker = "\n[truncated; omitted content is not evidence]";

// Include JSON escaping in the estimate; leave 2k tokens for question framing.
function serializedBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
function estimatedTokens(value: unknown): number { return Math.ceil(serializedBytes(value) / estimatedBytesPerToken); }
function boundedText(text: string, budget: number, tail = false): string {
  if (serializedBytes(text) <= budget) return text;
  if (budget < serializedBytes(truncationMarker)) return budget >= serializedBytes("[omitted]") ? "[omitted]" : "";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    const candidate = tail ? truncationMarker + text.slice(-length) : text.slice(0, length) + truncationMarker;
    if (serializedBytes(candidate) <= budget) low = length;
    else high = length - 1;
  }
  return tail ? truncationMarker + (low ? text.slice(-low) : "") : text.slice(0, low) + truncationMarker;
}

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
async function diffExcerpt(cwd: string, args: readonly string[]): Promise<{ text: string; truncated: boolean }> {
  const child = spawn("git", ["-C", cwd, "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", ...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 || (args.includes("--no-index") && code === 1) ? resolve() : reject(new Error(`git diff exited ${code}`)));
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-maxCheckOutputCharacters); });
  const chunks: Buffer[] = [];
  let bytes = 0;
  await Promise.all([completed, (async () => {
    for await (const chunk of child.stdout) {
      if (bytes < maxDiffBytes) chunks.push(Buffer.from(chunk).subarray(0, maxDiffBytes - bytes));
      bytes += Buffer.byteLength(chunk);
    }
  })()]).catch(error => { throw new Error(`${String(error)}: ${safeText(stderr)}`); });
  return { text: safeText(new StringDecoder("utf8").write(Buffer.concat(chunks))), truncated: bytes > maxDiffBytes };
}
async function collectDiff(cwd: string, base: string, acceptance: readonly AcceptanceCondition[]): Promise<{ diff: string; paths: string[] }> {
  const changed = (await git(cwd, ["diff", "--name-only", "--no-renames", "-z", base, "--"])).split("\0").filter(Boolean);
  const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const paths = [...new Set([...changed, ...untracked])].sort();
  const root = await realpath(cwd);
  for (const file of untracked) {
    const path = await realpath(resolve(cwd, file));
    const fromRoot = relative(root, path);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) throw new Error(`Untracked path escapes worktree: ${file}`);
  }
  const tracked = await diffExcerpt(cwd, [base, "--"]);
  let diff = tracked.text;
  let truncated = tracked.truncated;
  for (const file of untracked) {
    if (truncated || estimatedTokens(diff) > maxDiffTokens) { truncated = true; break; }
    const addition = await diffExcerpt(cwd, ["--no-index", "--", "/dev/null", file]);
    diff += `\n${addition.text}`;
    truncated ||= addition.truncated;
  }
  if (!truncated && estimatedTokens(diff) <= maxDiffTokens) return { diff, paths };
  const descriptions = acceptance.map(criterion => criterion.description).join("\n");
  const mentionedPaths = new Set(descriptions.match(/[\w./-]+/g)?.map(word => word.replace(/\.+$/, "")));
  const ordered = [...paths.filter(path => mentionedPaths.has(path)), ...paths.filter(path => !mentionedPaths.has(path))];
  const fileList = boundedText(paths.map(path => JSON.stringify(path)).join("\n"), 4_000);
  let summary = `Diff compacted; omitted changes are not evidence.\nChanged files:\n${fileList}\n\nHunks across changed files (criterion-named paths first):\n`;
  for (const [index, file] of ordered.entries()) {
    const budget = Math.floor((maxDiffBytes - serializedBytes(summary)) / (ordered.length - index)) - 2;
    if (budget < serializedBytes(truncationMarker)) break;
    const excerpt = await diffExcerpt(cwd, untracked.includes(file) ? ["--no-index", "--", "/dev/null", file] : [base, "--", file]);
    summary += `\n${boundedText(excerpt.text + (excerpt.truncated ? truncationMarker : ""), budget)}`;
  }
  return { diff: boundedText(safeText(summary), maxDiffBytes), paths };
}

export async function verifyAttempt(input: {
  execution: Execution;
  acceptance: readonly AcceptanceCondition[];
  session: SessionResult;
  attempt: number;
  attemptId?: string;
  checks: readonly string[];
  baseRevision: string;
  jev?: Pick<JevDecisionCore, "judgeAcceptance">;
  enforceSemantic?: boolean;
  settings: ReturnType<typeof verificationSettings>;
}): Promise<VerificationAttempt> {
  const startedAt = new Date().toISOString();
  const { execution, acceptance, session, settings } = input;
  const attemptId = input.attemptId ?? randomUUID();
  const blockers: string[] = [];
  const denials = session.telemetry?.permissionDenialDetails ?? [];
  const unknownDenials = (session.telemetry?.permissionDenials ?? 0) !== denials.length;
  if (session.exitCode !== 0 || session.failed || session.telemetry?.isError || unknownDenials) blockers.push(`Session failed: ${session.failureReasons?.join(", ") || (unknownDenials ? "unrecognized permission denial records" : `exit ${session.exitCode}`)}`);
  const checks: RepositoryCheckResult[] = [];
  for (const command of input.checks) checks.push(await runCheck(command, execution.worktree, settings.checkTimeoutMs));
  blockers.push(...checks.filter(check => check.status !== "pass").map(check => `Check failed: ${check.command} (exit ${check.exitCode ?? "unavailable"})${check.output ? ` — ${check.output.slice(-2_000)}` : ""}`));
  let diff = "";
  let publication: VerificationAttempt["publication"];
  try {
    if (input.baseRevision) {
      const collected = await collectDiff(execution.worktree, input.baseRevision, acceptance);
      diff = collected.diff;
      publication = { baseRevision: input.baseRevision, paths: collected.paths };
    }
  }
  catch (error) { blockers.push(`Diff unavailable: ${failureText(error)}`); }
  if (input.enforceSemantic && acceptance.length === 0) blockers.push("Explicit acceptance criteria are required");
  const tracker = new VerificationTracker(acceptance, execution.id);
  const evidence: Evidence[] = [
    ...checks.map((check, index) => ({ id: `check-${execution.id}-${attemptId}-${index}`, executionId: execution.id, kind: "test" as const, summary: `${check.command}: exit ${check.exitCode ?? "unavailable"}`, source: check.command, status: check.status })),
    { id: `diff-${execution.id}-${attemptId}`, executionId: execution.id, kind: "git" as const, summary: `Collected worktree diff (${diff.length} characters)`, status: "pass" as const },
    ...denials.map((denial, index): Evidence => ({ id: `denial-${execution.id}-${attemptId}-${index}`, executionId: execution.id, kind: "policy", summary: safeText(`Denied ${denial.toolName}: ${denial.input}`), status: "unresolved" })),
  ];
  let judgments: Awaited<ReturnType<JevDecisionCore["judgeAcceptance"]>> = [];
  let judgmentError: string | undefined;
  try {
    if (!input.jev) throw new Error("TypeSafe acceptance judge is not configured");
    const state = {
      diff,
      checks: checks.map(({ output, ...check }) => ({ ...check, output: output.length > maxCheckOutputCharacters ? truncationMarker + output.slice(-maxCheckOutputCharacters) : output })),
      session: { exitCode: session.exitCode, failed: blockers.length > 0, deniedTools: denials.map(denial => ({ ...denial })), toolResults: (session.telemetry?.toolResults ?? []).map(result => ({ ...result, denied: denials.some(denial => denial.toolUseId === result.toolUseId) })) },
      evidenceErrors: blockers,
    };
    const questionTokens = Math.max(0, ...acceptance.map(criterion => estimatedTokens(criterion)));
    let detailBudget = maxCheckOutputCharacters;
    while (estimatedTokens(state) + questionTokens > maxAcceptanceTokens && detailBudget > 0) {
      detailBudget = Math.floor(detailBudget / 2);
      state.checks = state.checks.map(check => ({ ...check, output: detailBudget ? boundedText(check.output, detailBudget, true) : "[output omitted]" }));
      state.session.deniedTools = state.session.deniedTools.map(denial => ({ ...denial, input: detailBudget ? boundedText(denial.input, detailBudget) : "[input omitted]" }));
      state.session.toolResults = state.session.toolResults.map(result => ({ ...result, input: detailBudget ? boundedText(result.input, detailBudget) : "[input omitted]", output: detailBudget ? boundedText(result.output, detailBudget, true) : "[output omitted]" }));
      state.evidenceErrors = state.evidenceErrors.map(error => detailBudget ? boundedText(error, detailBudget) : "[error detail omitted]");
    }
    const diffBudget = Math.min(maxDiffTokens, maxAcceptanceTokens - estimatedTokens({ ...state, diff: "" }) - questionTokens);
    if (diffBudget < estimatedTokens(truncationMarker)) throw new Error("Acceptance metadata exceeds the question budget; narrow the criteria or checks");
    state.diff = boundedText(diff, Math.floor(diffBudget * estimatedBytesPerToken));
    judgments = await input.jev.judgeAcceptance({ executionId: execution.id, attempt: input.attempt, attemptId, state, criteria: acceptance, threshold: settings.acceptanceThreshold });
  } catch (error) {
    if (input.enforceSemantic) { judgmentError = `Jev acceptance unavailable: ${failureText(error)}`; blockers.push(judgmentError); }
  }
  for (const judgment of judgments) {
    evidence.push({ id: `acceptance-${execution.id}-${attemptId}-${judgment.criterionId}`, executionId: execution.id, kind: "review", acceptanceId: judgment.criterionId, summary: `${judgment.criterionId}: Jev Noul probability ${judgment.probability.toFixed(3)}; threshold ${settings.acceptanceThreshold.toFixed(3)}`, source: "Jev Noul", status: judgment.passed ? "pass" : judgment.probability <= 1 - settings.acceptanceThreshold ? "fail" : "unresolved" });
  }
  tracker.addMany(evidence);
  const findings = tracker.findings().map(finding => ({ ...finding, note: evidence.find(item => item.acceptanceId === finding.conditionId)?.summary ?? judgmentError ?? "No acceptance judgment returned" }));
  if (input.enforceSemantic) blockers.push(...findings.filter(finding => finding.status !== "pass").map(finding => `${finding.conditionId}: ${finding.status} — ${finding.note}`));
  return { attempt: input.attempt, attemptId, startedAt, completedAt: new Date().toISOString(), checks, diff, evidence, findings, blockers, ...(publication ? { publication } : {}) };
}
export function repairPrompt(initial: string, attempt: VerificationAttempt): string {
  const failedFindings = attempt.findings.filter(finding => finding.status !== "pass");
  const failedChecks = attempt.checks.filter(check => check.status !== "pass");
  const blockers = attempt.blockers.filter(blocker => !blocker.startsWith("Check failed:") && !failedFindings.some(finding => blocker.startsWith(`${finding.conditionId}:`))).map(blocker => boundedText(blocker, 1_000));
  const failures = `Repair attempt ${attempt.attempt + 1}. Resolve these verification failures and preserve the acceptance requirements (${attempt.findings.map(finding => finding.conditionId).join(", ")}):\n${boundedText(blockers.join("\n"), 2_000)}\n\nFailing or unresolved criteria:\n${failedFindings.map(finding => `${finding.conditionId}: ${finding.status} — ${finding.note ?? ""}`).join("\n")}\n\nAuthoritative failing checks:\n${failedChecks.map(check => `Check failed: ${check.command}: exit ${check.exitCode ?? "unavailable"}`).join("\n")}\n\nDenied tools (these did not execute):\n${attempt.evidence.filter(item => item.kind === "policy" && item.status !== "pass").map(item => item.summary).join("\n")}\n\nFailing check output (tails, in check order):\n`;
  const outputBudget = Math.max(0, Math.floor((maxRepairEvidenceBytes - serializedBytes(failures)) / Math.max(1, failedChecks.length)) - 4);
  const output = failedChecks.map(check => boundedText(check.output.slice(-maxCheckOutputCharacters), outputBudget, true)).join("\n");
  return `${initial}\n\n${boundedText(failures + output, maxRepairEvidenceBytes)}`;
}
