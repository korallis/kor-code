import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decode } from "@toon-format/toon";
import { z } from "zod";
import type { Evidence, Execution, ShippingReport, ShippingStage, VerificationAttempt } from "@kor-code/core";
import type { KorRepositoryConfig } from "@kor-code/config";
import { redact } from "@kor-code/jev";
import type { LinearIssue } from "@kor-code/linear";

const exec = promisify(execFile);
const PR_TITLE_LIMIT = 200;
const PR_BODY_LIMIT = 60_000;
const PR_FIELD_LIMIT = 4_000;
const PR_TEMPLATE_LIMIT = 12_000;
const PR_SECTION_LIMIT = 4_000;
const PR_EVIDENCE_LIMIT = 24_000;
const PR_TEMPLATE_PATHS = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'docs/PULL_REQUEST_TEMPLATE.md'];
export interface ShippingCommandResult { code: number; stdout: string; stderr: string }
export type ShippingCommand = (file: string, args: string[], cwd: string) => Promise<ShippingCommandResult>;
export interface ShippingInput { execution: Execution; issue: LinearIssue; repository: KorRepositoryConfig }
export interface ShippingDriver {
  advance(input: ShippingInput): Promise<Execution>;
  cleanup(input: ShippingInput): Promise<Execution>;
}
const pipelineSchema = z.object({
  error: z.string().optional(),
  runs_on_current_branch: z.number().optional(),
  run: z.object({ id: z.string(), branch: z.string(), status: z.string(), head_sha: z.string(), pr: z.string().optional(),
    steps: z.array(z.object({ step: z.string(), status: z.string(), duration_ms: z.number() })).default([]),
  }).optional(),
  branch_sync: z.object({ pipeline: z.object({ run: z.string(), submitted_head: z.string() }).optional() }).optional(),
  gate: z.object({ step: z.string(), status: z.string(), summary: z.string().optional() }).optional(),
});
const pullRequestSchema = z.object({ number: z.number().int().positive(), html_url: z.url(), state: z.enum(["open", "closed"]), merged_at: z.string().nullable(), draft: z.boolean(), head: z.object({ sha: z.string(), ref: z.string() }), base: z.object({ ref: z.string() }) });
const checksSchema = z.object({ total_count: z.number(), check_runs: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable(), html_url: z.string().nullable() })) });
const statusesSchema = z.object({ total_count: z.number(), statuses: z.array(z.object({ context: z.string(), state: z.string(), target_url: z.string().nullable() })) });
const markerSchema = z.object({ executionId: z.string(), issueId: z.string(), path: z.string(), repository: z.string() });
function pipelineStepStatus(status: string): Evidence["status"] {
  return status === "completed" || status === "passed" ? "pass" : status === "failed" ? "fail" : "unresolved";
}
function safe(value: unknown): string { return String(redact(value instanceof Error ? value.message : String(value))).slice(0, 4_000); }
/** Credential/config artifacts are never added by the publication boundary. */
function sensitivePath(path: string): boolean {
  return path.split('/').some(part => /^(?:\.env(?:\..*)?|\.claude|\.codex|\.agents|\.ssh|\.aws|\.gnupg|\.npmrc|\.pypirc|id_.*|credentials(?:\..*)?|secrets?(?:\..*)?)$/i.test(part)
    || /\.(?:pem|key|p12|pfx|log)$/i.test(part));
}
function publicText(value: string, input: ShippingInput): string {
  let text = String(redact(value));
  for (const path of [input.execution.worktree, input.repository.path, process.env.HOME].filter((path): path is string => Boolean(path)).sort((a, b) => b.length - a.length)) text = text.split(path).join('[local-path]');
  // Standalone provider tokens may have no assignment or Bearer prefix.
  text = text.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]+)\b/g, '[redacted]');
  text = text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[redacted private key]');
  // Preserve web links, but remove Unix, Windows and home-relative local paths.
  text = text.replace(/(["'`])(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\/)[^\r\n]*?\1/g, '[local-path]');
  text = text.replace(/https?:\/\/[^\s<>"`]+|file:\/\/[^\s<>"`]+|(?<![\w:/])(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\/)[^\s<>"`]+/g, path => /^https?:\/\//.test(path) ? path : '[local-path]');
  return text;
}
const defaultCommand: ShippingCommand = async (file, args, cwd) => {
  try { const result = await exec(file, args, { cwd, timeout: 30_000, maxBuffer: 2_097_152 }); return { code: 0, ...result }; }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    return { code: "code" in error && typeof error.code === "number" ? error.code : -1,
      stdout: "stdout" in error && typeof error.stdout === "string" ? error.stdout : "",
      stderr: "stderr" in error && typeof error.stderr === "string" ? error.stderr : safe(error) };
  }
};

/** Incremental delivery: every return is persisted before the daemon advances again. */
export class GitHubShipping implements ShippingDriver {
  constructor(private readonly command: ShippingCommand = defaultCommand) {}
  private async run(file: string, args: string[], cwd: string): Promise<string> {
    const result = await this.command(file, args, cwd);
    if (result.code !== 0) throw new Error(`${file} failed (${result.code}): ${safe(result.stderr || result.stdout)}`);
    return result.stdout.trim();
  }
  private async daemonAvailable(cwd: string): Promise<void> {
    const output = await this.run('no-mistakes', ['daemon', 'status'], cwd);
    if (!/\bdaemon running\b/.test(output)) throw new Error(`no-mistakes daemon unavailable: ${safe(output)}`);
  }
  private async api(path: string, cwd: string): Promise<unknown> {
    const output = await this.run("gh-axi", ["api", path, "--jq", "tojson", "--full"], cwd);
    // gh-axi renders JSON objects/arrays directly as TOON, including jq tojson.
    // Each caller validates the decoded payload against the GitHub API schema.
    return decode(output);
  }
  private async target(input: ShippingInput): Promise<{ remote: string; slug: string }> {
    const remote = input.repository.remote ?? await this.run("git", ["remote", "get-url", "origin"], input.repository.path);
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote);
    if (!match?.[1]) throw new Error("Shipping requires an explicit github.com repository URL or an origin with that URL");
    return { remote, slug: match[1] };
  }
  private evidence(report: ShippingReport, executionId: string, key: string, kind: Evidence["kind"], status: Evidence["status"], summary: string, source?: string): void {
    const id = `shipping-${executionId}-${key}`;
    const evidence: Evidence = { id, executionId, kind, status, summary: safe(summary), ...(source ? { source } : {}) };
    const index = report.evidence.findIndex(item => item.id === id);
    if (index < 0) report.evidence.push(evidence); else report.evidence[index] = evidence;
  }
  private async stageVerifiedPaths(execution: Execution, verified: VerificationAttempt): Promise<void> {
    const publication = verified.publication;
    if (!publication || !/^[a-f0-9]{40,64}$/.test(publication.baseRevision)) throw new Error('Shipping requires the path manifest captured by verification; reverify before publication');
    const paths = new Set(publication.paths);
    for (const path of paths) {
      if (!path || path.startsWith('/') || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.git')) throw new Error('Verification contains an invalid repository path');
    }
    const readPaths = async (args: string[]) => {
      const result = await this.command('git', args, execution.worktree);
      if (result.code !== 0) throw new Error('Unable to inspect publication paths');
      return result.stdout.split('\0').filter(Boolean);
    };
    // Inspect both existing commits and the index: a session may have staged or committed a secret itself.
    const included = await readPaths(['diff', '--name-only', '--no-renames', '-z', publication.baseRevision, 'HEAD', '--']);
    const staged = await readPaths(['diff', '--cached', '--name-only', '--no-renames', '-z', '--']);
    for (const path of [...included, ...staged]) {
      if (!paths.has(path) || sensitivePath(path)) throw new Error('Commit or index contains a sensitive or unverified path; remove it and reverify before publication');
    }
    const untracked = new Set(await readPaths(['ls-files', '--others', '--exclude-standard', '-z']));
    const pending = new Set([...await readPaths(['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--']), ...untracked]);
    for (const path of pending) {
      if (!paths.has(path)) {
        if (!untracked.has(path)) throw new Error('Tracked changes appeared after verification; reverify before publication');
        continue;
      }
      if (sensitivePath(path)) {
        if (!untracked.has(path)) throw new Error('Sensitive tracked file changed; remove it and reverify before publication');
        continue;
      }
      // Literal pathspecs preserve spaces, newlines, glob characters, and leading dashes as filenames.
      await this.run('git', ['add', '--', `:(literal)${path}`], execution.worktree);
    }
  }
  async advance(input: ShippingInput): Promise<Execution> {
    const execution = structuredClone(input.execution);
    const report = execution.shipping;
    if (!report) throw new Error("Shipping requires a persisted verified execution");
    delete report.error;
    try {
      const verified = execution.verification?.attempts.at(-1);
      if (!execution.verification?.passed || !verified || verified.blockers.length || verified.checks.some(check => check.status !== 'pass') || !verified.findings.length || verified.findings.some(finding => finding.status !== 'pass')) throw new Error("Shipping requires passing repository checks and acceptance evidence");
      if (!execution.branch.startsWith("kor/") || execution.branch === input.repository.defaultBranch) throw new Error("Shipping may only publish a kor/ issue branch");
      const stage = report.stage;
      if (stage.kind === "merged" || stage.kind === "closed") return execution;
      const target = await this.target(input);
      if (stage.kind === "commit") {
        const branch = await this.run("git", ["branch", "--show-current"], execution.worktree);
        if (branch !== execution.branch) throw new Error("Shipping worktree branch no longer matches the execution");
        await this.stageVerifiedPaths(execution, verified);
        const diff = await this.command("git", ["diff", "--cached", "--quiet"], execution.worktree);
        if (diff.code === 1) await this.run("git", ["commit", "-m", `${input.issue.identifier ?? input.issue.id}: ${input.issue.title}`], execution.worktree);
        else if (diff.code !== 0) throw new Error("Cannot inspect staged changes before shipping");
        const head = await this.run("git", ["rev-parse", "HEAD"], execution.worktree);
        this.evidence(report, execution.id, "commit", "git", "pass", `Committed ${head} on ${execution.branch}`);
        const status = await this.command("no-mistakes", ["axi", "status"], execution.worktree);
        const decoded = pipelineSchema.parse(decode(status.stdout));
        if (status.code !== 0 && decoded.error === "repo not initialized (run 'no-mistakes init' first)") {
          report.stage = { kind: "publish", head };
          this.evidence(report, execution.id, "gate", "policy", "unresolved", "Repository is not initialized for no-mistakes; direct PR fallback");
        } else {
          if (status.code !== 0 || decoded.error || !decoded.run && decoded.runs_on_current_branch !== 0) throw new Error(decoded.error ?? (status.stderr || "Unrecognized no-mistakes status"));
          report.stage = { kind: "pipeline", head };
        }
        execution.status = "shipping";
      } else if (stage.kind === "pipeline") {
        await this.pipeline(input, execution, report, stage);
      } else if (stage.kind === "publish") {
        if (await this.run("git", ["rev-parse", "HEAD"], execution.worktree) !== stage.head || await this.run("git", ["status", "--porcelain", "--untracked-files=no"], execution.worktree)) throw new Error("Verified commit changed before publication");
        await this.run("git", ["push", target.remote, `${stage.head}:refs/heads/${execution.branch}`], execution.worktree);
        this.evidence(report, execution.id, "push", "git", "pass", `Pushed ${stage.head} to ${execution.branch}`);
        let prs = z.array(pullRequestSchema).parse(await this.api(`/repos/${target.slug}/pulls?state=all&head=${encodeURIComponent(`${target.slug.split('/')[0]}:${execution.branch}`)}&base=${encodeURIComponent(input.repository.defaultBranch)}&per_page=100`, execution.worktree));
        let pr = prs.find(item => item.head.ref === execution.branch && item.head.sha === stage.head);
        if (!pr) {
          if (prs.length) throw new Error("Existing PR for this branch does not match the verified commit");
          const directory = await mkdtemp(join(tmpdir(), "kor-pr-"));
          try {
            const bodyFile = join(directory, "body.md");
            await writeFile(bodyFile, await this.body(input, stage.head), { mode: 0o600 });
            await this.run("gh-axi", ["pr", "create", "--repo", target.slug, "--head", execution.branch, "--base", input.repository.defaultBranch, "--title", this.title(input), "--body-file", bodyFile], execution.worktree);
          } finally { await rm(directory, { recursive: true, force: true }); }
          prs = z.array(pullRequestSchema).parse(await this.api(`/repos/${target.slug}/pulls?state=all&head=${encodeURIComponent(`${target.slug.split('/')[0]}:${execution.branch}`)}&per_page=100`, execution.worktree));
          pr = prs.find(item => item.head.ref === execution.branch && item.head.sha === stage.head);
        }
        if (!pr) throw new Error("GitHub did not return the published PR");
        report.stage = { kind: "review", mode: "direct", head: stage.head, url: pr.html_url, number: pr.number };
        await this.review(input, execution, report);
      } else await this.review(input, execution, report);
      if (!report.error) report.evidence = report.evidence.filter(item => item.id !== `shipping-${execution.id}-delivery`);
    } catch (error) {
      report.error = safe(error);
      execution.status = "blocked";
      this.evidence(report, execution.id, "delivery", "policy", "unresolved", report.error);
    }
    return execution;
  }
  private async pipeline(input: ShippingInput, execution: Execution, report: ShippingReport, stage: Extract<ShippingStage, { kind: "pipeline" }>): Promise<void> {
    // A missing daemon must not be mistaken for a still-running cached record.
    await this.daemonAvailable(execution.worktree);
    const status = await this.command("no-mistakes", ["axi", "status", ...(stage.runId ? ["--run", stage.runId] : [])], execution.worktree);
    let parsed = pipelineSchema.parse(decode(status.stdout));
    if (!parsed.run && (status.code !== 0 || parsed.error)) throw new Error(parsed.error ?? status.stderr);
    if (!parsed.run) {
      if (stage.runId) throw new Error("Recorded no-mistakes run disappeared; refusing to start another run");
      if (parsed.runs_on_current_branch !== 0) throw new Error('Unrecognized no-mistakes status; refusing to start another run');
      const started = await this.command("no-mistakes", ["axi", "run", "--intent", `${input.issue.title}\n\n${input.issue.description ?? ''}`, "--no-publish-intent", "--base-branch", input.repository.defaultBranch, "--wait", "1s"], execution.worktree);
      parsed = pipelineSchema.parse(decode(started.stdout));
      if (!parsed.run) throw new Error(parsed.error ?? "no-mistakes did not report a durable run; will inspect status before retrying");
    }
    // Rebase and fixes may move the current head before the startup call returns.
    // Refresh that response by run ID if it did not include submission identity.
    if (!stage.runId && parsed.run.head_sha !== stage.head && !parsed.branch_sync?.pipeline) {
      const refreshed = await this.run("no-mistakes", ["axi", "status", "--run", parsed.run.id], execution.worktree);
      const snapshot = pipelineSchema.parse(decode(refreshed));
      if (!snapshot.run || snapshot.run.id !== parsed.run.id) throw new Error("Started no-mistakes run identity changed before attachment");
      parsed = snapshot;
    }
    const run = parsed.run;
    if (!run) throw new Error("no-mistakes did not return a run for attachment");
    const submission = parsed.branch_sync?.pipeline;
    const matchesSubmittedHead = submission ? submission.run === run.id && submission.submitted_head === stage.head : run.head_sha === stage.head;
    if (run.branch !== execution.branch || (stage.runId ? run.id !== stage.runId : !matchesSubmittedHead)) throw new Error("no-mistakes run does not match this branch and submitted commit");
    report.stage = { ...stage, runId: run.id };
    for (const step of run.steps) this.evidence(report, execution.id, `pipeline-${step.step}`, "review", pipelineStepStatus(step.status), `no-mistakes ${step.step}: ${step.status}; duration_ms=${step.duration_ms}`, `no-mistakes axi logs --run ${run.id} --step ${step.step} --full`);
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.gate) throw new Error(`no-mistakes gate ${parsed.gate.step}: ${parsed.gate.summary ?? parsed.gate.status}; operator response required in ${execution.worktree}`);
    if (["failed", "cancelled", "canceled", "blocked", "ci-monitor-interrupted"].includes(run.status)) throw new Error(`no-mistakes run ${run.id}: ${run.status}; operator action required`);
    if (run.pr) {
      const { slug } = await this.target(input);
      const url = new URL(run.pr);
      const match = new RegExp(`^/${slug.replaceAll('.', '\\.')}\/pull\/(\\d+)$`).exec(url.pathname);
      if (url.origin !== "https://github.com" || !match?.[1]) throw new Error("Pipeline PR belongs to a different repository");
      report.stage = { kind: "review", mode: "no-mistakes", head: run.head_sha, url: run.pr, number: Number(match[1]), runId: run.id };
      await this.review(input, execution, report);
    } else if (run.status === "completed") throw new Error("Pipeline completed without a PR; publication remains unresolved");
    else execution.status = "shipping";
  }
  private async review(input: ShippingInput, execution: Execution, report: ShippingReport): Promise<void> {
    const stage = report.stage;
    if (stage.kind !== "review") return;
    let pipelineError: string | undefined;
    if (stage.mode === "no-mistakes") {
      try {
      if (!stage.runId) throw new Error('Pipeline review has no recorded run ID');
      await this.daemonAvailable(execution.worktree);
      const status = await this.command('no-mistakes', ['axi', 'status', '--run', stage.runId], execution.worktree);
      const parsed = pipelineSchema.parse(decode(status.stdout));
      if (!parsed.run || parsed.run.id !== stage.runId || parsed.run.branch !== execution.branch) throw new Error('Pipeline review run identity changed');
      for (const step of parsed.run.steps) this.evidence(report, execution.id, `pipeline-${step.step}`, 'review', pipelineStepStatus(step.status), `no-mistakes ${step.step}: ${step.status}; duration_ms=${step.duration_ms}`, `no-mistakes axi logs --run ${stage.runId} --step ${step.step} --full`);
      if (status.code !== 0 || parsed.error || parsed.gate || ['failed', 'cancelled', 'canceled', 'blocked', 'ci-monitor-interrupted'].includes(parsed.run.status)) throw new Error(parsed.error ?? `no-mistakes ${parsed.gate?.step ?? parsed.run.status} requires operator action`);
      } catch (error) { pipelineError = safe(error); }
    }
    const { slug } = await this.target(input);
    const pr = pullRequestSchema.parse(await this.api(`/repos/${slug}/pulls/${stage.number}`, input.repository.path));
    if (pr.html_url !== stage.url || pr.head.ref !== execution.branch || pr.base.ref !== input.repository.defaultBranch) throw new Error("PR identity no longer matches this execution");
    if (pr.draft) throw new Error("PR is still a draft; mark it ready before review");
    if (stage.mode === "direct" && pr.head.sha !== stage.head) throw new Error("PR head changed since verification");
    this.evidence(report, execution.id, "pr", "git", "pass", `PR ${pr.merged_at ? "merged" : pr.state}: ${pr.html_url}; head=${pr.head.sha}`, pr.html_url);
    // CI availability cannot undo a merge fact. Record an unavailable check read explicitly.
    report.evidence = report.evidence.filter(item => !item.id.startsWith(`shipping-${execution.id}-ci-`));
    try {
    const checks = checksSchema.parse(await this.api(`/repos/${slug}/commits/${pr.head.sha}/check-runs?per_page=100`, input.repository.path));
    const statuses = statusesSchema.parse(await this.api(`/repos/${slug}/commits/${pr.head.sha}/status?per_page=100`, input.repository.path));
    for (const [index, check] of checks.check_runs.entries()) this.evidence(report, execution.id, `ci-check-${index}`, "test", check.status !== "completed" ? "unresolved" : check.conclusion === "success" ? "pass" : ["neutral", "skipped"].includes(check.conclusion ?? '') ? "unresolved" : "fail", `CI ${check.name}: ${check.status}/${check.conclusion ?? "pending"}; head=${pr.head.sha}`, check.html_url ?? undefined);
    for (const [index, check] of statuses.statuses.entries()) this.evidence(report, execution.id, `ci-status-${index}`, "test", check.state === "success" ? "pass" : check.state === "pending" ? "unresolved" : "fail", `CI ${check.context}: ${check.state}; head=${pr.head.sha}`, check.target_url ?? undefined);
    if (checks.total_count > checks.check_runs.length || statuses.total_count > statuses.statuses.length) this.evidence(report, execution.id, "ci-limit", "test", "unresolved", "CI response exceeded 100 entries; evidence is incomplete");
    if (!checks.total_count && !statuses.total_count) this.evidence(report, execution.id, "ci-none", "test", "unresolved", `No GitHub CI checks reported for ${pr.head.sha}; local verification is recorded separately`);
    } catch (error) { this.evidence(report, execution.id, 'ci-unavailable', 'test', 'unresolved', `CI unavailable: ${safe(error)}`); }
    report.stage = { ...stage, head: pr.head.sha, kind: pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "review" };
    execution.status = pr.merged_at ? "complete" : pr.state === "closed" ? "failed" : "review";
    if (pr.state === "closed" && !pr.merged_at) report.error = "PR closed without merge; issue is not Done and worktree is retained";
    if (pipelineError) {
      this.evidence(report, execution.id, 'pipeline-status', 'policy', 'unresolved', pipelineError);
      if (!pr.merged_at && pr.state === 'open') { execution.status = 'blocked'; report.error = pipelineError; }
    } else report.evidence = report.evidence.filter(item => item.id !== `shipping-${execution.id}-pipeline-status`);
  }
  async cleanup(input: ShippingInput): Promise<Execution> {
    const execution = structuredClone(input.execution);
    const report = execution.shipping;
    if (!report || report.stage.kind !== "merged" || report.cleanup === "removed") return execution;
    try {
      const markerFile = `${execution.worktree}.kor-worktree.json`;
      const registered = await this.run("git", ["worktree", "list", "--porcelain"], input.repository.path);
      const record = registered.split(/\n\n/).find(entry => entry.split('\n').includes(`worktree ${resolve(execution.worktree)}`));
      const absent = async (path: string) => access(path).then(() => false).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true;
        throw error;
      });
      if (!record && await absent(execution.worktree) && await absent(markerFile)) {
        report.cleanup = 'removed'; delete report.error;
        return execution;
      }
      const marker = markerSchema.parse(JSON.parse(await readFile(markerFile, "utf8")));
      if (marker.executionId !== execution.id || marker.issueId !== execution.issueId || resolve(marker.repository) !== resolve(input.repository.path) || resolve(marker.path) !== resolve(execution.worktree)) throw new Error("Worktree ownership marker does not match merged execution");
      if (record) {
        if (!record.split('\n').includes(`branch refs/heads/${execution.branch}`)) throw new Error("Merged worktree branch changed; retaining it");
        if (await this.run("git", ["status", "--porcelain"], execution.worktree)) throw new Error("Merged worktree has uncommitted changes; retaining it");
        await this.run("git", ["worktree", "remove", execution.worktree], input.repository.path);
      }
      await unlink(markerFile);
      report.cleanup = "removed";
      delete report.error;
      this.evidence(report, execution.id, "cleanup", "git", "pass", "Removed owned clean worktree after observed merge; retained branch and evidence");
    } catch (error) {
      report.error = safe(error);
      this.evidence(report, execution.id, "cleanup", "git", "unresolved", report.error);
    }
    return execution;
  }
  private title(input: ShippingInput): string {
    const title = publicText(input.issue.title, input).replace(/[\r\n]+/g, ' ').trim().replace(/\.+$/, '');
    return (/^(?:feat|fix|refactor|perf|docs|ci|chore)\([\w.-]+\): .+/.test(title) ? title : `chore(task): ${title}`).slice(0, PR_TITLE_LIMIT);
  }
  private async body(input: ShippingInput, head: string): Promise<string> {
    const latest = input.execution.verification?.attempts.at(-1);
    const field = (text: string) => publicText(text, input).slice(0, PR_FIELD_LIMIT);
    const bounded = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}\n\n[Truncated; see local Kor status for the full report.]` : text;
    const summary = [field(input.issue.title), field(`${input.issue.identifier ?? input.issue.id}${input.issue.url ? `: ${input.issue.url}` : ''}`)].join('\n\n');
    const changelog = `- Changed: ${field(input.issue.title).replace(/\s+/g, ' ')}`;
    const checks: string[] = [];
    let checkLength = 0;
    for (const check of latest?.checks ?? []) {
      const output = `$ ${field(check.command)}\nexit ${check.exitCode}\n${field(check.output)}`;
      const fence = '`'.repeat(Math.max(3, ...Array.from(output.matchAll(/`+/g), match => match[0].length + 1)));
      const block = `${fence}text\n${output}\n${fence}`;
      if (checkLength + block.length > PR_EVIDENCE_LIMIT) {
        checks.push('[Evidence truncated; see local Kor status for the full report.]');
        break;
      }
      checks.push(block);
      checkLength += block.length;
    }
    const verification = [
      field(`Execution: ${input.execution.id}`),
      ...(input.execution.shipping?.evidence.filter(evidence => evidence.id === `shipping-${input.execution.id}-gate`).map(evidence => field(evidence.summary)) ?? []),
      ...checks,
      'Only the recorded checks and acceptance findings were verified. Browser or client flows are not implied by a passing command.',
    ].join('\n\n');
    const checklist = bounded(latest?.findings.map(finding => {
      const condition = input.execution.manifest?.acceptance.find(item => item.id === finding.conditionId);
      return `- [${finding.status === 'pass' ? 'x' : ' '}] ${field(condition?.description ?? finding.conditionId).replace(/\s+/g, ' ')}: ${field(`${finding.status}${finding.note ? `; ${finding.note}` : ''}`).replace(/\s+/g, ' ')}`;
    }).join('\n') || '- [ ] No acceptance findings were recorded.', PR_SECTION_LIMIT);
    const screenshots = bounded(latest?.evidence.flatMap(evidence => {
      if (evidence.status !== 'pass' || !evidence.source || !/^https:\/\/[^\s<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>]*)?$/i.test(evidence.source)) return [];
      return [`![${field(evidence.summary).replace(/[\[\]\r\n]/g, ' ')}](<${field(evidence.source)}>)`];
    }).join('\n\n') || 'No public screenshot evidence was recorded. Visual changes require before and after captures.', PR_SECTION_LIMIT);
    const sections = { summary, changelog, verification, screenshots, checklist };
    for (const path of PR_TEMPLATE_PATHS) {
      const template = await this.command('git', ['show', `${head}:${path}`], input.execution.worktree);
      if (template.code !== 0) continue;
      if (template.stdout.length > PR_TEMPLATE_LIMIT) throw new Error('Repository PR template exceeds the publication limit; shorten it before shipping');
      const used = new Set<string>();
      let rendered = publicText(template.stdout, input);
      for (const [key, value] of Object.entries(sections)) {
        const slot = `{{${key}}}`;
        if (!rendered.includes(slot)) continue;
        used.add(key);
        rendered = rendered.split(slot).join(value);
      }
      const evidence = [!used.has('verification') ? verification : '', !used.has('checklist') ? checklist : '', !used.has('screenshots') ? screenshots : ''].filter(Boolean).join('\n\n');
      const body = publicText([rendered, evidence ? `---\n\nKor execution evidence\n\n${evidence}` : ''].filter(Boolean).join('\n\n'), input);
      if (body.length > PR_BODY_LIMIT) throw new Error('Rendered repository PR template exceeds the publication limit; reduce repeated placeholders before shipping');
      return body;
    }
    return publicText([
      `## What does this PR do?\n\n${summary}`,
      `## Changelog\n\n${changelog}`,
      `## How was it tested?\n\n${verification}`,
      `## Screenshots\n\n${screenshots}`,
      `## Checklist\n\n${checklist}`,
    ].join('\n\n'), input);
  }
}
