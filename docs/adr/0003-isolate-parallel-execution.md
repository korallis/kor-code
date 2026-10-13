# ADR 0003: Isolate every parallel execution

- Status: accepted
- Date: 2026-10-13

## Context

Several issues and projects may run at once. Shared working directories create collisions and unclear test results.

## Decision

Give each execution its own branch or Git worktree. Record repository, branch, worktree, execution ID, and Linear issue on the execution manifest.

## Consequences

Parallel work is traceable and reversible. The controller must create, reconcile, and remove worktrees. Shared changes need explicit reconciliation.
