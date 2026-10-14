# Kor Code implementation plan

## Phase 0: prove external contracts

Verify Linear authentication and objects, Claude Code session hooks, gateway catalogue and account behaviour, quota responses, streaming, and tool compatibility.

Completion criterion: a harness reads a test issue, starts a non-destructive session, calls one verified route, and writes a test activity to Linear.

## Phase 1: Linear foundation — Validated

Build the Linear client, webhook receiver, event deduplication, snapshot reader, durable queue, execution lease, agent-session record, and update writer.

Completion criterion: a test issue moves through queued, running, and completed with one linked execution. The fake Linear probe demonstrates this lifecycle and ignores a replayed webhook delivery.

## Phase 2: execution controller — Validated

Build repository lookup, isolated worktrees, session launcher, event collector, restart reconciliation, and concurrency limits.

Completion criterion: two test issues run concurrently without sharing uncommitted files or losing their Linear links. `pnpm controller:fixture` demonstrates this against two fake Linear issues. The Phase 2 evidence also covers sandbox path isolation, lease renewal, and killed-run reconciliation.

## Phase 3: Jev core

**Validated** — Build typed decision requests, batched preflight, route selection, skill and agent selection, context relevance, confidence, escalation, and decision audit. `pnpm jev:fixture` demonstrates batched route, skill, agent, and context fixture decisions, typed Noul/Score answers, low-confidence escalation, JSON audit persistence, and identical replay without another Jev call.

Completion criterion: every applied fixture decision can be explained and replayed.

## Phase 4: gateway

Build the live catalogue, account health, fill-first affinity, safe retry, quota failover, capability checks, and route telemetry.

Completion criterion: a controlled quota test moves one session to the next account without replaying a partial stream. **Validated locally:** `pnpm gateway:quota-proof` exercises a simulated 429 against the recorded `files` auth-files shape and records two distinct opaque health slots with `streamStartedOnQuota=false`. The one fixed-route live probe was **Blocked** by a missing runtime API key. CLIProxyAPI remains the authority for the actual credential binding.

## Phase 5: context and verification — Validated

Build repository-rule discovery, context manifests, compaction, redaction, and per-execution acceptance tracking. The `@kor-code/context` package discovers only rule files inside the resolved execution worktree, bounds the redacted excerpts sent to Jev, records dropped sources, and exercises Jev relevance ranking through a fixture callback. The `@kor-code/verification` tracker associates evidence with the current execution's required acceptance conditions; the Linear controller creates a fresh tracker for every execution, records a verification block, and rejects completion until all required conditions have passing evidence. `pnpm phase5:proof` demonstrates one fake Linear execution blocked without evidence, evidence from a second execution not counting for it, and completion after the first execution receives its own evidence.

Review evidence is currently a typed evidence factory only; GitHub review/check integration remains Proposed. The controller now runs repository-configured checks, collects the worktree diff, asks one Jev Noul per acceptance condition, and retries failed verification at most twice. `pnpm verification:proof` demonstrates both repair and a terminal blocked execution with per-criterion findings.

Completion criterion: an execution cannot reach complete while one acceptance condition lacks evidence.

## Phase 6: cockpit

Start from one tested visual layer. Add the issue, project, decision stream, agents, account pool, context, Linear links, overrides, and drill-downs.

Completion criterion: a fixture execution is visible and every non-live value is labelled.

Status: Validated on fixture data. `pnpm cockpit:proof` runs the fixture execution through all seven stages and every view in the sandboxed Claude Code and checks each row's provenance label; live data arrives as Phases 1-5 land.

## Phase 7: calibration — Validated locally

Compare real tasks with a fixed-route baseline. `@kor-code/calibration` adds additive `calibration_runs`, `run_metrics`, `run_outcomes`, and decision-audit tables to the daemon's SQLite database. Sampling is a stable execution-id hash, so daemon restarts cannot silently spend a second baseline run. The baseline callback receives the same pair id and base revision and records only a throwaway arm. `kor calibrate report` prints Jev and baseline side by side (success rate, repairs, cost, cache hit rate, wall clock, failovers, verification failures, policy blocks, and clarifications) with sample sizes and confidence bins/Brier scores.

`pnpm calibration:proof` drives the actual daemon, the same preflight factory as `kor serve`, and the controller. It demonstrates a paired sample, crash/restart/retry with one durable route decision, cleared stale outcomes, and the report. `--live-jev` is **Validated** with real TypeSafe preflight and acceptance calls; `--fallback` is **Validated locally** with a forced outage, a blocked execution and zero pairs. The proof uses fixture Linear data, session generation and telemetry; gateway execution and live Linear intake are not exercised by this proof. T7 daemon wiring is complete.
