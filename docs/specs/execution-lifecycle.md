# Execution lifecycle specification

## Stages

**Status: Validated.** Discovery snapshots, lease ownership, session records, state transitions, evidence-gated completion, outbox writes, repository lookup, isolated worktrees, sandboxed session launch, event collection, restart reconciliation, and concurrency limits are implemented in `@kor-code/linear` and `@kor-code/controller`. The controller fixture runs two issues concurrently and confirms separate worktrees and retained Linear session links.

~~~mermaid
flowchart LR
    D[Discover] --> P[Preflight]
    P --> C[Context package]
    C --> X[Execute]
    X --> S[Supervise]
    S --> V[Verify]
    V --> U[Synchronise]
    S --> E[Escalate]
    V --> R[Repair]
    R --> X
~~~

### Discover

Read selected projects, documents, issues, dependencies, and sessions.

Completion criterion: the controller has a consistent snapshot ID and candidate issue list.

### Preflight

Ask Jev to classify intent, complexity, risk, skills, execution shape, route, and verification depth.

Completion criterion: the controller has a decision bundle or a recorded clarification blocker.

### Context package

Retrieve repository rules, relevant files, prior decisions, linked documents, and acceptance conditions. Remove stale output.

Completion criterion: the session manifest names every context source and purpose.

### Execute

Create an isolated worktree, start selected sessions, and apply deterministic guards.

Completion criterion: the agent produces a change set, blocker, or failure record.

### Supervise

Watch progress, scope, provider state, tool errors, and dependencies. Ask Jev whether to continue, delegate, retry, or escalate.

Completion criterion: the execution reaches verification, repair, waiting, or escalation with a reason.

### Verify

Run tests, static checks, reviews, and acceptance checks. Gather GitHub evidence.

Completion criterion: every acceptance condition has a pass, fail, or unresolved status.

### Synchronise

Write progress, findings, evidence, pull-request links, blockers, and final state to Linear.

Completion criterion: the Linear issue and agent session reflect the verified outcome.

## Execution manifest

~~~yaml
execution_id: exec_01KOR...
linear_issue_id: LIN-123
linear_project_id: project_matilda
repository: github.com/example/matilda
worktree: /worktrees/exec_01KOR
branch: kor/lin-123-performance
route:
  provider: claude
  model: sonnet
  account_policy: fill-first
agents:
  - id: investigator
    role: repository investigation
    status: running
acceptance:
  - id: regression-covered
    status: pending
    evidence: []
status: running
~~~

A restart reconciles leases, provider request IDs, agent state, worktree existence, branch state, pull-request state, and pending Linear updates.

Phase 2 sessions invoke `scripts/sandbox.sh --run` with a per-execution `HOME`,
`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and XDG directories. The launcher filters
`.claude`, `.codex`, and `.agents` entries from `PATH`, passes only runtime
environment values, and supplies the plugin directory explicitly. The sandbox
script does not inspect the caller's home directory or CLIProxyAPI files.
