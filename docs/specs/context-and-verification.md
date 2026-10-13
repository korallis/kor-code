# Context and verification specification

**Status: Validated for worktree-only discovery, bounded redaction/compaction, Jev fixture ranking, and the per-execution gate on fake Linear. Review/check integration and automated test collection are Proposed.**

## Context boundary

Repository rules are discovered after resolving the execution worktree. Discovery recursively reads only repository-owned `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `CONTRIBUTING.md`, `INSTRUCTIONS.md`, and Markdown files under `.claude/rules/`; `.git` and `node_modules` are skipped. A resolved path must remain inside the worktree. The discovery code never reads user homes, Claude or Codex configuration, agent directories, or CLIProxyAPI files.

Context sources carry a stable identifier, relative path, purpose, and Jev relevance score. Jev receives bounded redacted excerpts; a caller rank callback is an explicit recorded override. The manifest records the execution, repository, worktree, selected sources, dropped source references, compaction, and redaction state. Compaction truncates sources to a bounded character budget while preserving source order. All text, including the issue sent to Jev, passes through the existing `@kor-code/jev` `redact` function.

## Verification boundary

`VerificationTracker` stores evidence for one execution and maps it to acceptance conditions through `acceptanceId`. A required condition is passing only when at least one linked evidence item has `status: pass`; missing, unresolved, or failing evidence cannot complete an execution. `assertComplete()` raises `VerificationError` with the condition findings, and the controller records that block before releasing the lease for an explicit retry. Review evidence uses the same core evidence contract, but no GitHub review/check adapter is implemented yet.

When a Linear runtime is configured, the controller creates a fresh tracker from `execution.manifest.acceptance` for every dispatch. A zero-exit session is passed through that tracker before `AgentSessionWriter.complete`; an incomplete tracker records a verification block, leaves the issue running, releases the lease, and raises a verification error. A retry may re-execute the session with new evidence. Runs without a Linear writer have no completion transition to gate.
