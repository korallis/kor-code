# Context and verification specification

**Status: Validated.** `@kor-code/context` and `@kor-code/verification` implement the Phase 5 contracts. The proof script exercises the completion gate against fake Linear.

## Context boundary

Repository rules are discovered after resolving the execution worktree. Discovery recursively reads only repository-owned `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and `INSTRUCTIONS.md` files; `.git` and `node_modules` are skipped. A resolved path must remain inside the worktree. The discovery code never reads user homes, Claude or Codex configuration, agent directories, or CLIProxyAPI files.

Context sources carry a stable identifier, relative path, purpose, and Jev relevance score. An optional Jev rank callback chooses relevance; deterministic ordering breaks ties. The manifest records the execution, repository, worktree, selected sources, compaction, and redaction state. Compaction truncates sources to a bounded character budget while preserving source order. All text passes through the existing `@kor-code/jev` `redact` function.

## Verification boundary

`VerificationTracker` stores evidence and maps it to acceptance conditions through `acceptanceId`. A required condition is passing only when at least one linked evidence item has `status: pass`; missing, unresolved, or failing evidence cannot complete an execution. `assertComplete()` raises `VerificationError` with the condition findings. Review evidence uses the same core evidence contract.

The controller accepts an optional tracker. A zero-exit session is passed through the tracker before `AgentSessionWriter.complete`; an incomplete tracker therefore leaves the lease uncompleted and raises a verification block. Existing controller callers without a tracker retain their Phase 2 completion behavior.
