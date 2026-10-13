# Kor Code implementation plan

## Phase 0: prove external contracts

Verify Linear authentication and objects, Claude Code session hooks, gateway catalogue and account behaviour, quota responses, streaming, and tool compatibility.

Completion criterion: a harness reads a test issue, starts a non-destructive session, calls one verified route, and writes a test activity to Linear.

## Phase 1: Linear foundation

Build the Linear client, webhook receiver, event deduplication, snapshot reader, durable queue, execution lease, agent-session record, and update writer.

Completion criterion: a test issue moves through queued, running, and completed with one linked execution.

## Phase 2: execution controller

Build repository lookup, isolated worktrees, session launcher, event collector, restart reconciliation, and concurrency limits.

Completion criterion: two test issues run concurrently without sharing uncommitted files or losing their Linear links.

## Phase 3: Jev core

Build typed decision requests, batched preflight, route selection, skill and agent selection, context relevance, confidence, escalation, and decision audit.

Completion criterion: every applied fixture decision can be explained and replayed.

## Phase 4: gateway

Build the live catalogue, account health, fill-first affinity, safe retry, quota failover, capability checks, and route telemetry.

Completion criterion: a controlled quota test moves one session to the next account without replaying a partial stream. **Validated:** `pnpm gateway:quota-proof` exercises a simulated 429 and records `account-01 -> account-02` with `streamStartedOnQuota=false`.

## Phase 5: context and verification

Build repository-rule discovery, context manifests, compaction, redaction, acceptance tracking, tests, and review evidence.

Completion criterion: an execution cannot reach complete while one acceptance condition lacks evidence.

## Phase 6: cockpit

Start from one tested visual layer. Add the issue, project, decision stream, agents, account pool, context, Linear links, overrides, and drill-downs.

Completion criterion: a fixture execution is visible and every non-live value is labelled.

## Phase 7: calibration

Compare real tasks with a fixed-route baseline. Track completion quality, repair attempts, token use, cache hit rate, wall-clock time, failovers, verification failures, policy blocks, and clarification rate.
