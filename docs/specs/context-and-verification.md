# Context and verification specification

**Status: Controller context delivery is implemented. Worktree-only discovery, bounded redaction/compaction, per-execution evidence gates, configured checks and bounded repair have runnable proofs. GitHub review/check integration remains Proposed.**

## Context boundary

Repository rules are discovered after resolving the execution worktree. Discovery recursively reads only repository-owned `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `CONTRIBUTING.md`, `INSTRUCTIONS.md`, and Markdown files under `.claude/rules/`; `.git`, `node_modules` and generated `.kor` directories are skipped. Rule reads are bounded to 256 KiB and do not follow file symlinks. A resolved path must remain inside the worktree. The discovery code never reads user homes, Claude or Codex configuration, agent directories, or CLIProxyAPI files.

Context sources carry a stable identifier, relative path, purpose, and Jev relevance score. Jev receives bounded redacted excerpts; a caller rank callback is an explicit recorded override. The manifest records the execution, repository, worktree, selected sources, dropped source references, compaction, and redaction state. Compaction truncates sources to a bounded character budget while preserving source order. All text, including the issue sent to Jev, passes through the existing `@kor-code/jev` `redact` function.

## Session delivery

The controller calls `buildContextManifest` after creating the execution worktree.
The task text informs ranking without being duplicated in the context block.
Candidates include repository rules, Linear documents, supplied evidence, up to
40 tracked file hints, and ticket-image captions. A word-overlap prefilter bounds
the file shortlist; Jev's recorded context decision supplies its final order using
the full probability map. No file bodies are read for file hints. When Jev is
unavailable, deterministic source priorities remain in effect. Routing continues
through the separate per-task route decision.

The first prompt and each repair prompt retain the selected context. The context
block is capped at **2,000 UTF-8 bytes**, a conservative upper bound of 2,000
byte-tokenized text tokens without depending on a provider tokenizer. It reserves
800 bytes for ranked guidance, 400 for up to five file hints and 800 for screens;
each guidance excerpt is at most 600 characters. This budget includes headings
and paths. Redaction runs before Jev sees source text and again on delivery.
Hints are advisory: sessions can search and read other policy-permitted files.

Claude execution sessions use explicit `claudeMdExcludes: ["**"]` and disabled
auto memory through `--settings`, alongside `--setting-sources ""`. The execution
sandbox no longer sets `CLAUDE_CODE_DISABLE_CLAUDE_MDS`. Native instruction files
are excluded so the ranked excerpt is the automatic repository-rule channel.
The separate cockpit sandbox retains its isolation switch. A custom launcher
`args` override must preserve these settings itself.

Markdown images in the issue description, comments and documents, plus resources
whose URLs have image extensions, become image candidates. Kor downloads at most
three in ranked order to `.kor/context/<ISSUE>/screens/` and lists local paths for
`Read`. PNG, JPEG, WebP and GIF responses are supported, with a 5 MiB limit per
image and a 15-second request timeout. Images must use direct HTTPS URLs resolving to public addresses, without URL
credentials or custom ports; redirects and private address ranges are rejected.
Public image hosts receive anonymous requests. Only `uploads.linear.app` receives
`HttpLinearClient`'s existing runtime Linear credential for private assets; credentials never
enter the execution environment. Images are downloaded locally, not injected as
base64 into the text prompt; image-viewing tokens are separate from the text cap.
Text redaction does not inspect image pixels.

The context directory is private to the worktree (directories mode 0700, files
0600), cannot escape it through directory symlinks, and has a generated `.gitignore`
that excludes its contents from verification diffs and publication. The lease
heartbeat remains active while ranking and downloading. A failed or unsupported
image is listed as unavailable with an attachment hint; it does not silently
pretend that a screen was supplied.

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
original task prompt and a reminder of the criterion IDs remain intact. Each
non-check blocker is capped at 1,000 bytes, with 2,000 bytes shared across those
blockers, so a large diagnostic cannot displace the failing-check tails.

The diff supplied to Jev has a 24,000-token estimated budget. Token estimates
use 3 serialized UTF-8 bytes per token, including JSON escaping. This allows up
to 72,000 serialized bytes of diff evidence; bytes and tokens are separate units.
A mid-sized diff below this estimate reaches Jev in full. Oversized diffs include
a sorted file list and hunks shared across all changed files, with paths named in
the criteria considered first. A criterion without a path still receives evidence
from later files. File-list and hunk omissions are marked and cannot count as
evidence. Tracked and untracked diffs are streamed, so large output does not exhaust
a subprocess buffer.

Check output and tool details are shortened only when the combined state and
largest criterion exceed the 30,000-token estimate, leaving 2,000 estimated tokens
for question framing. Smaller diffs leave more room for tool evidence. Exit codes,
check statuses, denied-call identities and tool error flags remain authoritative.
If criterion/check metadata alone cannot fit, verification blocks with an
actionable budget error. Estimates differ from Jev's tokenizer; the live proof
records server-reported input usage alongside the local estimates. Semantic
approval never overrides a failed process or repository check.

Run the live budget proof after installing dependencies and building Kor:

```sh
pnpm exec tsx scripts/verification-budget-proof.ts
pnpm verification:proof
```

The first command uses the existing TypeSafe runtime credentials, creates a
scratch Git repository, runs a check producing 100,000 characters with exit 7,
and asks the real Jev judge about a diff above the cap. It also judges a mid-sized
diff with a path-free criterion, then a larger version requiring compaction,
including ordinary and maximum-sized tool-record fixtures. A large-blocker check
confirms the failed-check tail survives. It prints token estimates, server usage,
judgment and unavailability counts, and the scratch artifact directory. It does
not launch an agent or publish anything. The second command runs the existing
repair/retry proof.
