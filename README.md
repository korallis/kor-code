# Kor Code

Kor Code is the documentation project for a Linear-first engineering environment governed by Jev.

The design gives one control plane to read project intent from Linear, choose models and agents, run isolated Claude Code sessions, use an account-aware subscription gateway, and write evidence back to Linear.

This repository contains the foundation monorepo and documentation. The foundation exposes typed integration boundaries and runnable probes. Model compatibility is recorded by `pnpm kor models probe --family claude` and listed by `pnpm kor models list`. `kor plan LEE-57` runs one Jev preflight for readiness, complexity, risk, route, skill, and agent choices, then records the decisions in SQLite.

## Read first

1. [Architecture](docs/architecture.md)
2. [Requirements](docs/requirements.md)
3. [Domain glossary](docs/GLOSSARY.md)
4. [Specifications](docs/specs/)
5. [Decision records](docs/adr/)
6. [Implementation plan](docs/implementation-plan.md)
7. [Open questions](docs/open-questions.md)
8. [Model compatibility](docs/model-compatibility.md)
9. [Configuration and doctor](docs/configuration.md)

## Responsibility split

| System | Owns |
| --- | --- |
| Linear | Projects, issues, intent, dependencies, sessions, progress, and delivery history |
| Jev Code | Selection, decomposition, routing, context, policy, supervision, verification, and escalation |
| Claude Code | Repository work, tools, coding, tests, and reviews |
| Provider gateway | Credentials, account selection, quotas, retries, and failover |
| GitHub | Repositories, branches, pull requests, checks, and review state |

Linear is the source of truth for intent. GitHub is the source of truth for versioned code. Jev is the decision plane between them.

## Design status

- **Proposed** means the conversation selected the direction, but no implementation evidence exists here.
- **Validated** means a local or integration check supports the statement.
- **Blocked** means an external account, provider, or product behaviour prevents validation.
- **Illustrative** means a mock value or UI state, not live telemetry.
- **Verified** means a model passed the recorded sandbox compatibility probe and is routable.

The cockpit labels every row it draws:

- **LIVE** means the daemon answered over HTTP just now and the value is younger than its poll interval.
- **STALE** means the last value the daemon published, read from its snapshot file when it did not answer, or older than the poll interval; the row's section shows its age.
- **UNAVAILABLE** means the daemon did not report the value, or neither the daemon nor a snapshot could be read.
- **FIXTURE** means demo data, drawn only by `/kor demo`; it is the cockpit's form of Illustrative.

## Foundation

The TypeScript pnpm workspace contains `core`, `jev`, `gateway-adapter`, `linear`, `controller`, `context`, `verification`, `config`, `cli`, and `claude-plugin` packages. Run `pnpm probe` for the external contract checks and read the [Phase 0 probe record](docs/phase-0-probe.md). Use `scripts/sandbox.sh` to load the Claude Code plugin in a disposable `CLAUDE_CONFIG_DIR`; it never installs the plugin globally or changes the existing Claude Code configuration, runs offline unless `--live-model` opts in to CLIProxyAPI, and `pnpm isolation:proof` traces the sandboxed session to show it never touches the real Claude, Codex or agents homes or port 8317.

The Phase 6 cockpit (`packages/claude-plugin`) is Validated on a live daemon run: `/kor` draws the daemon's status with LIVE, STALE and UNAVAILABLE labels, `/kor override` sends overrides to the daemon, and `/kor demo` keeps the fixture execution, which `pnpm cockpit:proof` replays (see [Open the live cockpit](#open-the-live-cockpit)). Execution sessions are Validated locally with parsed stream-json telemetry and policy checks; `pnpm e2e:live` runs the scratch-repository hello-file check when supplied a runtime `KOR_GATEWAY_KEY` or `KOR_GATEWAY_KEY_FILE` (without a key it reports the external validation as Blocked and makes no provider call). Sessions use `dontAsk` with an explicit repository tool allowlist, so removing `Write` produces a permission denial and a failed attempt. See the [cockpit specification](docs/specs/cockpit-mockups.md).

Verification runs each configured repository check and treats its exit code as authoritative. It collects the worktree diff, asks Jev one Noul per acceptance criterion at the controller's verification threshold option (default `0.7`), and retries a blocked attempt at most twice with the failing evidence in the next prompt. Run the offline proof:

```sh
pnpm verification:proof
```

```text
verification-proof: repair: complete; launches=2; state=completed; findings=recorded; repair-evidence=recorded; blocker=none
verification-proof: broken: blocked (acceptance-1=pass); launches=3; state=started; findings=recorded; repair-evidence=recorded; blocker=recorded
```

Configure checks on a repository entry with `checks: ["pnpm typecheck", "pnpm test"]`. A failed check or unmet acceptance criterion leaves the execution blocked and records each criterion finding in the Linear comment.

For the live scratch run, the script's repository allowlist contains `Read,Write,Edit` and the three `git` commands needed to commit the hello file. To prove a policy failure, remove `Write` from `KOR_E2E_ALLOWED_TOOLS` and set `KOR_E2E_EXPECT_FAILURE=1`; the command reports the provider's permission denial and failed attempt. A launcher with no repository allowlist defaults to `Read`, so mutation is opt-in. Credentials are runtime-only and are never written to the repository or printed.

### Run a live execution

Load the gateway settings into the current shell, then run the disposable hello-file session:

```sh
set -a
source ~/.config/kor/gateway.env
set +a
KOR_E2E_DIR=/tmp/kor-t1-live-success pnpm e2e:live
```

The command creates a scratch repository, creates a `kor/e2e-*` branch, commits `hello.txt`, and prints the selected model and cost. A successful run produced:

```text
e2e:live passed; branch=kor/e2e-1791974354926; hello=yes; committed=yes; model=claude-haiku-4-5-20251001; cost_usd=0.04701935; duration_ms=5450; permission_denials=0
```

Remove `Write` from the allowlist to check the failure path:

```sh
KOR_E2E_DIR=/tmp/kor-t1-live-denial \
KOR_E2E_ALLOWED_TOOLS='Read,Edit,Bash(git status *),Bash(git add *),Bash(git commit *)' \
KOR_E2E_EXPECT_FAILURE=1 pnpm e2e:live
```

The session then reports permission denials and does not report success:

```text
e2e:live failed; branch=kor/e2e-1791974375194; hello=no; committed=no; model=claude-haiku-4-5-20251001; cost_usd=0.05174289999999999; duration_ms=8983; permission_denials=2
e2e:live failure=2 permission denials
```

## Check model compatibility

Install the workspace before using the `kor` commands:

```sh
pnpm install
```

Run a probe with a gateway key supplied at runtime. The probe discovers models from the gateway's `/v1/models` response, starts one isolated sandbox session per selected model, and writes verified results to `~/.local/state/kor/models.json`.

```sh
export KOR_GATEWAY_KEY="<your runtime gateway key>"
pnpm kor models probe --model claude-haiku-5-5
```

The table reports each capability independently. A model is routable only when streaming, tool calls, thinking, and structured output all pass.

```text
MODEL	STREAMING	TOOL_CALLS	THINKING	STRUCTURED_OUTPUT	COST_USD	DURATION_MS
claude-haiku-5-5	pass	pass	pass	pass	0.004184965	5118
```

Use `--family claude` to probe every Claude model returned by the gateway. Use `--dry-run` to list the selected models without starting sessions. To inspect the verified models later, run:

```sh
pnpm kor models list
```

```text
MODEL	FAMILY	CAPABILITIES	COST_USD	DURATION_MS
claude-haiku-5-5	claude	streaming,tool_calls,thinking,structured_output	0.004184965	5118
```

Set `KOR_MODEL_REGISTRY` when you need a disposable registry for a proof or a CI job. The gateway key is never written to the registry or printed by these commands.

## Kor configuration and doctor

Kor reads `~/.config/kor/config.yaml` (or `XDG_CONFIG_HOME/kor/config.yaml`) and keeps runtime state under `~/.local/state/kor` and execution data under `~/.local/share/kor`. A minimal configuration is:

```yaml
repos:
  kor-code:
    path: /home/lee/Projects/kor-code
    remote: https://github.com/korallis/kor-code.git
    linearTeam: LEE
    defaultBranch: main
    checks: [pnpm typecheck]
    toolAllowlist: [Read, Write, Edit, "Bash(git status*)"]
limits: { total: 2, perRepository: 1 }
defaultRoute: { provider: anthropic, model: claude-sonnet-5-5, accountPolicy: fill-first, sessionAffinity: true, reasoningLevel: medium }
pollIntervalSeconds: 60
intakeLabel: kor
```

Put the Kor client credential in `~/.config/kor/gateway.env` with mode `0600`, for example `KOR_GATEWAY_KEY=...`; environment variables take precedence. `pnpm kor doctor` prints bounded `PASS`/`FAIL` lines for credentials, CLIProxyAPI, management, quota-axi, Claude Code, no-mistakes, and every configured repository. When the Kor key is absent it prints one generated key-list item, such as `CLIProxyAPI addition: - kor-<generated-value>`. Add that exact item to CLIProxyAPI's `api-keys` list and store the same value in `gateway.env`. The doctor never edits the proxy or any user configuration.

With a pilot config and the runtime key loaded, the command exits zero:

```text
$ pnpm kor doctor
PASS Kor config: /tmp/kor-t2-proof/config/kor/config.yaml
PASS Linear key: available
PASS TypeSafe key: available
PASS CLIProxyAPI with Kor key: reachable
PASS CLIProxyAPI management access: available
PASS quota-axi: available
PASS Claude Code: 2.1.299 (Claude Code)
PASS no-mistakes daemon: available
PASS repo kor-code: /home/lee/.treehouse/kor-code-bb1e5c/3/kor-code (main)
```

With the key removed, the gateway line is red and the command exits one:

```text
FAIL CLIProxyAPI with Kor key: missing; CLIProxyAPI addition: - kor-<generated-value>
```

## Plan a Linear issue

Run a preflight for an issue identifier that you can read with the configured personal Linear key:

```sh
pnpm kor plan LEE-1101
```

The command prints the route, each decision, and its confidence. It writes redacted decision records to `~/.local/state/kor/kor.db`. A missing or invalid TypeSafe response keeps readiness `blocked` and marks the configured route `fallback`. A healthy but uncertain or non-applicable response keeps the route `escalated`, which is distinct from an outage. When a decision needs captain input, Kor writes one stable-ID clarification comment to the Linear issue. The command exits one while readiness is blocked, a decision is escalated, or a fallback route is in use.

```text
PLAN plan-<uuid>
route: anthropic/claude-sonnet-5-5 [fallback]
fallback: true
jev: unavailable (TypeSafe API key not found ...)
readiness: blocked (0.00); confidence=0.00; status=blocked
complexity: escalate (0.00); confidence=0.00; status=blocked
risk: escalate (0.00); confidence=0.00; status=blocked
route: claude-sonnet-5-5; confidence=0.00; status=blocked
skill: escalate; confidence=0.00; status=blocked
agent: escalate; confidence=0.00; status=blocked
linear: clarification comment written
```

### Queue an issue for the daemon

Add a `linearTeam` or `linearProject` mapping to the repository entry in `config.yaml`, then preview the durable queue operation for a Todo issue. The command resolves the issue key to its canonical Linear UUID before writing SQLite, so polling and manual commands address the same assignment:

```sh
pnpm kor run LEE-123 --dry-run
```

```text
{"issueId":"LEE-123","canonicalIssueId":"<linear-uuid>","dryRun":true,"queued":false}
```

Run it without `--dry-run` to enqueue the canonical assignment. This daemon path owns the durable queue and execution status; its CLI does not perform the direct Linear progress writes from the standalone preflight command. `kor cancel LEE-123` and `kor retry LEE-123` resolve the same canonical issue before changing the durable assignment.

### Operate the daemon

Install the user service with `cp systemd/kor.service ~/.config/systemd/user/kor.service`, then run `systemctl --user daemon-reload` and `systemctl --user enable --now kor`.
The daemon polls Todo issues carrying the configured `kor` label, stores leases in `~/.local/state/kor/kor.db`, and publishes snapshots under `~/.local/state/kor/snapshots/`.
Use `kor status --json`, `kor run ISSUE-ID`, `kor cancel ISSUE-ID`, `kor retry ISSUE-ID`, and `kor logs EXECUTION-ID`.
The read-only HTTP equivalent is `http://127.0.0.1:8327/status`.
Status values are `queued`, `running`, `shipping`, `review`, `complete`, `failed`, `blocked`, and `canceled`; response provenance is `live`, `stale`, or `unavailable`. With shipping enabled by `kor serve`, `complete` means GitHub reports a merged PR.

The local daemon proof covers lease renewal, restart recovery, queued and running cancellation, terminal failure and retry, orphan worktree cleanup, and PID identity protection:

```text
$ pnpm daemon:proof
daemon proof passed; picked=LEE-57; status=live; restart=queued; attempts=1; orphan=removed; lease=exclusive; cancel=terminal; failure=retryable; pid-guard=pass
```

## Run the Kor daemon

After `pnpm install` and a `~/.config/kor/config.yaml`, install the user service with `cp systemd/kor.service ~/.config/systemd/user/kor.service`, then run `systemctl --user daemon-reload` and `systemctl --user enable --now kor`.
The daemon polls Todo issues carrying the configured `kor` label, stores leases in `~/.local/state/kor/kor.db`, and publishes snapshots under `~/.local/state/kor/snapshots/`.
It polls each repository's `linearTeam` (else the team part of its map key) and runs a claimed issue in the checkout `repositoryKeyForIssue` maps it to (`linearProject`, then `linearTeam`).
Use `kor status --json`, `kor run LEE-n` (a queue entry; the daemon writes Linear progress), `kor cancel LEE-n`, `kor retry ISSUE-ID`, and `kor logs EXECUTION-ID`.
The HTTP equivalent is `http://127.0.0.1:8327/status`; the cockpit also posts overrides there (see [Open the live cockpit](#open-the-live-cockpit)).
Status values are `queued`, `running`, `shipping`, `review`, `complete`, `failed`, `blocked`, and `canceled`; response provenance is `live`, `stale`, or `unavailable`.
`retry` is explicit for terminal failures and verification blocks, while a running cancellation stops the detached session group before recording `canceled`.

The local daemon proof exercises intake, the loopback endpoint, lease renewal during an 800 ms run with a 200 ms lease, restart recovery, queued and running cancellation, terminal failure and retry, orphan worktree cleanup, and PID identity protection:

```text
$ pnpm daemon:proof
daemon proof passed; picked=LEE-57; status=live; restart=queued; attempts=1; orphan=removed; lease=exclusive; cancel=terminal; failure=retryable; pid-guard=pass
```

No live Linear or gateway credential was used for this proof; credentials are supplied at runtime by the configured environment.

### Ship a verified issue

After `pnpm install --frozen-lockfile` and `pnpm build`, the daemon host needs Git,
authenticated `gh-axi`, and no-mistakes. Set the repository's GitHub URL in `remote`
(or use its GitHub `origin`), configure checks and tool permissions, and supply the
existing Linear and TypeSafe runtime credentials. Run the daemon and queue an issue:

```sh
pnpm kor serve
# In another terminal:
pnpm kor run LEE-123 --dry-run
pnpm kor run LEE-123
pnpm kor status --json
```

Passing checks and Jev acceptance judgments move the execution to `shipping`.
Kor commits on `kor/LEE-123` and runs the repository's no-mistakes gate. Only an
explicit “repo not initialized” response selects the direct `gh-axi pr create`
fallback. Approval gates stay `blocked` for an operator to resolve; an outage never
bypasses the gate. The existing run resumes on later polls without another session.

An open, ready PR is linked on Linear in **In Review** and appears as `review` in
status. `verification`, `shipping.evidence`, and `pullRequestUrl` show the local
checks, pipeline steps, and GitHub CI results. No CI checks means **unresolved**.
After an operator merges, Kor observes the merge, moves Linear to **Done**, reports
`complete`, and removes only its owned clean worktree. Dirty worktrees remain with
a cleanup error; PRs closed without merge remain `failed` and retain their worktree.

The shipping flow is **Validated locally** for real Git, SQLite, HTTP snapshots,
and live Jev judgments; the gate, forge and Linear writes, and cleanup are
**Illustrative contract replays**. The live initialized-repository pilot has not
run under T6's direct-PR worker contract. See the [shipping specification](docs/specs/shipping.md)
for recovery rules, operator actions, and the exact validation boundary.

## Open the live cockpit

The cockpit is the Claude Code mod in `packages/claude-plugin`. Until `kor install` lands, load it in the sandboxed Claude Code with the daemon running:

```sh
pnpm kor serve &                 # or the systemd unit
pnpm cockpit                     # the TUI; type /kor
scripts/sandbox.sh "/kor"        # the same view, printed once
```

`/kor` reads `http://127.0.0.1:8327/status` and falls back to `~/.local/state/kor/snapshots/index.json`. Set `KOR_STATUS_URL` and `KOR_STATE_DIR` to read another daemon, `KOR_STATUS_URL=off` to read only the snapshot, and `KOR_COCKPIT=off` to hide the status line. During a real run of LEE-1108, it printed:

```text
── Execution
  [LIVE]         Execution    10ce738c-0111-4da1-9000-6b35549e1794 · LEE-1108 · RUNNING
  [LIVE]         Stage        4/7 execute
  [LIVE]         Route        claude-sonnet-5-5 · medium (fallback)
  [LIVE]         Claude Code  2.1.299

── Current issue · LEE-1108
  [LIVE]         Kor T8 cockpit live check (throwaway)

── Decision stream (latest 6)
  [LIVE]         13:27:41  route: claude-haiku-4-5-20251001  confidence 0.08 · escalated

── Subscription pool
  [LIVE]         claude  1 / 6 available
  [LIVE]         codex   3 / 3 available
```

Jev escalated the route choice (confidence below 0.7), so the configured default route ran, labelled `fallback`. Overrides go to the daemon, which applies one only when policy allows, records it in the `override_audit` table of `kor.db` and in `kor logs`, and comments on the Linear issue:

```text
/kor override route claude-haiku-5-5
[LIVE] ovr_ae50e254: route → claude-haiku-5-5 applied (Applies from the next attempt; the running session keeps its model.)

/kor override route claude-opus-5-5
[LIVE] daemon refused: ovr_e493c84c: route → claude-opus-5-5 rejected (Policy refused it: model verified by kor models probe.)
```

A route override must name a model `kor models probe` verified, and the execution must not be finished. Name a decision ID instead of `route` to override another Jev decision with one of its candidates; `/kor revert <override>` undoes one. Stopping the daemon turns its values STALE, with their age, from the last snapshot:

```text
── Execution · stale, observed 64s ago
  [STALE]        Execution    911a7cab-5dbf-40ea-ad21-9e8928af73bb · LEE-1109 · COMPLETE
  [STALE]        Route        claude-haiku-5-5 · medium (override)
[STALE 2m] Kor LEE-1109 · synchronise 7/7 · complete · claude-haiku-5-5 · medium (override) · 1 override · [LIVE] CC 2.1.299
```

With no daemon and no snapshot every daemon value is `[UNAVAILABLE]`, and `/kor override` sends nothing. `/kor demo` (and `/kor demo replay`) draws the fixture execution instead, labelled `[FIXTURE]`; its overrides stay in the session.
