# Context and verification specification

**Status: Validated for worktree-only discovery, bounded redaction/compaction, Jev fixture ranking, per-execution evidence gates, configured check execution, diff collection, and bounded repair on fake Linear. GitHub review/check integration remains Proposed.**

## Context boundary

Repository rules are discovered after resolving the execution worktree. Discovery recursively reads only repository-owned `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `CONTRIBUTING.md`, `INSTRUCTIONS.md`, and Markdown files under `.claude/rules/`; `.git` and `node_modules` are skipped. A resolved path must remain inside the worktree. The discovery code never reads user homes, Claude or Codex configuration, agent directories, or CLIProxyAPI files.

Context sources carry a stable identifier, relative path, purpose, and Jev relevance score. Jev receives bounded redacted excerpts; a caller rank callback is an explicit recorded override. The manifest records the execution, repository, worktree, selected sources, dropped source references, compaction, and redaction state. Compaction truncates sources to a bounded character budget while preserving source order. All text, including the issue sent to Jev, passes through the existing `@kor-code/jev` `redact` function.

## Verification boundary

`VerificationTracker` stores evidence for one execution and maps it to acceptance conditions through `acceptanceId`. A required condition is passing only when at least one linked evidence item has `status: pass`; missing, unresolved, or failing evidence cannot complete an execution. `assertComplete()` raises `VerificationError` with the condition findings, and the controller records that block before releasing the lease for an explicit retry. Each configured repository check is run in the execution worktree; its exit code is authoritative. Kor collects the diff and asks Jev one Noul per criterion using the controller's verification threshold option (default `0.7`), then retries with the failed check and criterion findings at most twice. A final failure records every criterion finding and blocker in Linear and cannot transition to complete. Review evidence uses the same core evidence contract, but no GitHub review/check adapter is implemented yet.

When a Linear runtime is configured, the controller creates a fresh tracker from `execution.manifest.acceptance` for every dispatch. A session is followed by each configured repository check in the worktree; the process exit code is authoritative. Kor captures the diff and asks Jev one Noul per criterion over the check output and diff, using the controller's verification threshold option. A blocked attempt is retried with its exact findings at most twice. The latest attempt must have a successful session, passing checks, and passing findings before `AgentSessionWriter.complete`; otherwise every criterion finding and blocker is written to Linear, the issue remains running, the lease is released, and a verification error is raised. Invalid or cross-execution evidence is recorded as a verification block as well. Runs without a Linear writer still raise on a configured verification failure, so an unmet criterion never appears complete.

Execution sessions receive the configured tool permissions and exact simple repository check commands. An explicitly permitted `bash` or `sh` script also receives direct relative invocation aliases only when it resolves to an executable file inside the execution worktree with the same shebang interpreter. Absolute paths, escaping symlinks, traversal and generic shell patterns do not create aliases. The prompt names the effective permissions and checks; this does not add general shell or network access.

The launcher parses actual denied tool calls and tool results from Claude's event stream. Verification records bounded redacted denial evidence, and Jev sees the denied operations separately from actual tool output. A denied operation did not execute: an unmet required criterion still blocks, while a denied optional inspection need not invalidate independently demonstrated work. Nonzero process exit, error results, unknown denial records and failed authoritative checks remain hard blockers. Repair prompts retain the denied command details, and immutable acceptance audits retain the bounded output used for each judgment.

Each launched verification session has a fresh UUID independent of its numeric attempt ordinal. The installed daemon reserves the UUID in SQLite before launch, including when calibration is disabled. Reports, evidence IDs, acceptance audit IDs and calibration metrics carry that identity. Explicit retries and restart recovery create new IDs; prior numeric audit IDs remain readable and are never overwritten. Library consumers can supply a durable reservation callback; without one, UUIDs still prevent collisions, but pre-launch reservations are not persisted. An interrupted reservation remains recorded even if no verification judgment was produced.

## Prompt budgets

Verification retains full redacted check records locally. Repairs include failing
checks and failing or unresolved findings; passing evidence is excluded. Each
failed check contributes up to its last 4,000 characters, sharing the remaining
budget across failures when many checks fail. The added repair evidence has
a 16,000-byte serialized budget, with explicit truncation if it is exhausted. The
original task prompt and a reminder of the criterion IDs remain intact; passing
findings and passing check output are excluded.

The diff supplied to Jev has a 24,000-token ceiling. Kor uses UTF-8 bytes of
serialized JSON as a conservative token upper bound, including JSON escaping;
ordinary text therefore compacts before it reaches 24,000 actual tokens. Small
diffs are unchanged. Oversized diffs include a sorted file list and hunks for
changed paths mentioned in the criteria, sharing the available space across those
files. If no changed path is named, the summary includes the start of the diff.
File-list and hunk omissions are marked and cannot count as evidence. Tracked and
untracked diffs are streamed, so large output does not exhaust a subprocess buffer.

Check output and tool details are shortened further when necessary to reserve
space for the diff. Exit codes, check statuses, denied-call identities and tool
error flags remain authoritative. State plus the largest criterion stays within a
30,000-token upper bound, leaving 2,000 tokens for Jev's question instructions and
framing. If criterion/check metadata alone cannot fit, verification blocks with an
actionable budget error rather than sending an oversized question. Semantic
approval never overrides a failed process or repository check.

Run the live budget proof after installing dependencies and building Kor:

```sh
pnpm exec tsx scripts/verification-budget-proof.ts
pnpm verification:proof
```

The first command uses the existing TypeSafe runtime credentials, creates a
scratch Git repository, runs a check producing 100,000 characters with exit 7,
and asks the real Jev judge about a diff above the cap. It prints conservative
prompt-token upper bounds, judgment and unavailability counts, and the scratch
artifact directory. It does not launch an agent or publish anything. The second
command runs the existing repair/retry proof.
