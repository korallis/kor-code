# Jev preflight

`kor plan` asks Jev five independent questions in one request:

- a Noul for readiness;
- a Score for complexity;
- a Score for risk;
- a Choice over verified gateway models;
- a Choice for the configured agent roster.

The CLI supplies the issue, acceptance criteria, dependency states, and verified model catalogue as structured state. Code keeps policy checks deterministic. A missing acceptance section, incomplete dependency, or empty verified catalogue fails readiness even when Jev's probability is high.

Each applied response is redacted and stored in the `decision_audit` table in the configured Kor SQLite database. The audit has the request, answer, probability data, confidence, and applied decision. A stable UUID derived from the canonical Linear issue ID makes clarification comments safe to retry.

If the TypeSafe request cannot return a valid typed response, Kor records five blocked decisions, uses the configured route with the `fallback` label, and leaves readiness `blocked`. `kor plan` writes a clarification comment and exits with status one; it never dispatches work. The daemon retains the configured route fallback on a Jev outage, but unavailable acceptance judgment prevents completion. Missing acceptance, incomplete dependencies, and a healthy readiness rejection block dispatch and produce a durable clarification comment plus `kor:blocked` on Linear. Resumed execution removes only that Kor label.

Daemon retries replay the immutable preflight while the issue intent, dependency states, and eligible models remain identical. Changed inputs create a separate decision revision under the same execution ID, so a clarification can resolve readiness without overwriting the earlier rejection. Workflow state, comments, and labels do not invalidate the preflight.

The design was checked with Jev before implementation and again after the review fixes. Jev selected the separate SQLite audit, configured rosters, explicit thresholds, and the labelled fallback policy. The catalogue proposal scored 0.68 confidence because live gateway model capability data can be incomplete. The implementation therefore requires the verified registry and treats an empty registry as blocked. The repair choices were to distinguish healthy escalation from service outage (0.90), describe route candidates and readiness criteria (0.82), and use an update operation for recorded outcomes (0.38, which remains a follow-up choice for the user).

## Tool capability decisions

Before launching each initial or repair session, the controller sends four
independent `tools` Nouls in one request. They judge shell, live browser,
external web evidence and sub-agents from the current task. These decisions
are separate from the five issue preflight questions, so the actual worktree's
resolved permissions and current repair evidence are available.

The normal tool set is derived from effective permission base names. Optional
web, browser and sub-agent tools are excluded until a yes probability reaches
0.8. Code intersects every selection with repository permissions and any
`tools` ceiling. The shell judgment is audit evidence; `Bash` stays available
for permitted inspection and checks and never gains broader commands.

Each capability has an immutable `tools-<execution>-<revision>-<capability>`
audit record, including its Noul probability, eligible tool names and
`tools-allowed` policy check. The revision hashes task text and effective
policy. Identical retries replay decisions; changed repair evidence or policy
creates a new revision. A TypeSafe outage records unapplied decisions with a
failed `jev-available` check and keeps the lean set. Missing Jev also keeps the
lean set. These decisions neither read nor change the task's route.

## Session skills decision

Skill selection runs at launch, after effective tools and worktree dependencies
are known. It replaces the old `generalist/testing` placeholder. Each initial or
repair session asks two shuffled Choices over up to 100 eligible skills plus
`none-needed`, averages probabilities and derives a budgeted `plan` on a `skills`
decision. The full plan, both samples and usage survive audit explain/replay.
Outages produce a labelled fallback plan with repository `always` guidance only.
See [skills selection](../skills.md#jev-selection-and-context-budgets) for the
configuration, tier rules, proof commands and measurement limits. Model, provider,
harness and effort remain owned by the independent task route decision.
