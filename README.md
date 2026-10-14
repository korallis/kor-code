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

`pnpm typecheck` runs Claude's plugin validator in a throwaway HOME and configuration directory, so validation cannot migrate your user settings. To run the validator alone:

```sh
bash scripts/validate-plugin.sh packages/claude-plugin
```

The isolated run ended with `✔ Validation passed`; its caller's `opus` settings and file inventory stayed unchanged. See [validation isolation](ISOLATION.md#plugin-validation).

The reversible installer is Validated in a disposable HOME and XDG tree for both local pilot and user scope. It stages Claude Code's local-path marketplace commands in a private HOME, publishes only Kor entries, restores the exact settings bytes on uninstall, and leaves `claude plugin list --json` without Kor. The revision proof used an `opus` user setting, a linked sandbox worktree, and an unrelated plugin refresh; uninstall preserved that plugin and its updated registry entries. The proof used the offline endpoint and no live gateway key. It validated the generated unit with `systemd-analyze --user verify`; systemctl sequencing used a command shim, so service lifecycle on the real user manager remains unvalidated.

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
    path: /home/lee/Projects/firstmate/projects/kor-code
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

## Install and undo Kor

Use Node 24+, pnpm, Git, Claude Code 2.1.299 or newer, and a Linux systemd user manager. Build the workspace, then install from a stable checkout that you will keep on disk:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/cli.js install --pilot ~/Projects/firstmate/projects/kor-code
export PATH="$HOME/.local/bin:$PATH"
kor --help
kor models list
```

The installed `kor` symlink runs the compiled CLI without rebuilding. Install writes a systemd user unit with the checkout's working directory and absolute Node path, a config scaffold, and a private `gateway.env`. It registers `kor-cockpit@kor` through a local-path marketplace under Kor's data directory. In stage one, both the marketplace declaration and cockpit are local to `--pilot`; user settings stay byte-identical, including the `opus` alias. Plugin commands run in a private staging HOME so Claude cannot migrate those settings during installation. The installed cockpit activates only when Claude runs at the exact canonical pilot directory; inherited settings in linked worktrees do not activate commands, polling, UI or policy hooks. **A local install refuses linked Git worktrees** because Claude 2.1.299 writes their local settings into the primary checkout. Use a normal clone for the pilot.

The service is installed and reloaded but not started. Add a Linear mapping (`linearTeam` or `linearProject`), checks and tool allowlist to the scaffold before running work. When no gateway credential exists, install generates one, stores it in `gateway.env` with mode `0600`, and prints the exact line to add to CLIProxyAPI's `api-keys`. Existing credentials are retained and never printed. Kor never edits CLIProxyAPI configuration.

Use `--no-systemd` on a host without a user manager or for a disposable HOME proof. It writes the unit but skips systemctl during both install and uninstall. A sandbox run produced this output (the generated key is redacted):

```text
Kor installed (scope: local)
CLI: <sandbox-home>/.local/bin/kor
Config: <sandbox-home>/.config/kor/config.yaml
Service: <sandbox-home>/.config/systemd/user/kor.service (not started; systemd control skipped)
Cockpit: kor-cockpit@kor only when Claude starts in <sandbox-home>/pilot (linked worktrees disabled)
Manifest: <sandbox-home>/.local/state/kor-install/manifest.json
CLIProxyAPI addition: - kor-<generated-value>
Stored the same new key in <sandbox-home>/.config/kor/gateway.env (0600). Add the printed line to CLIProxyAPI manually.
Configure repository mapping, checks and toolAllowlist; run kor doctor before starting the service.
```

After configuring credentials and policy, run `kor doctor`, then `systemctl --user enable --now kor`. Open Claude in the pilot and type `/kor`. The real sandbox proof loaded the cockpit there, while `/kor-status` in its linked worktree reached the offline endpoint without activating Kor:

```text
kor-code-cockpit: Kor Code cockpit plugin loaded (session-local; no configuration changes).
[UNAVAILABLE] Kor · daemon down: /kor for why · [LIVE] CC 2.1.299
```

After the pilot is accepted, change scope by uninstalling and reinstalling. The normal uninstall retains config and runtime data, so the user-scope install reuses them:

```sh
kor uninstall
node packages/cli/dist/cli.js install --scope user
```

`kor uninstall` stops/disables a managed Kor service and replays the manifest: restores prior settings, the pilot's `.git/info/exclude`, CLI link and unit, and removes the cockpit and marketplace. It removes only Kor entries from Claude's current registries, preserving unrelated plugin installs and automatic refreshes. Shared-file backups include both original and installed bytes. Unrelated settings edits stop uninstall before restoration and name the installed snapshot to restore after saving your edits. Claude's automatic JSON reformatting and `opus` → `opus[1m]` migration do not block restoration of the original settings bytes. The installer never reads or rewrites user session metadata. See [the recovery details](docs/configuration.md#install-and-uninstall).

```sh
kor uninstall
claude plugin list --json
```

The sandbox run had no other installed plugins:

```text
Kor uninstalled; config and state retained
Backups: <sandbox-home>/.local/state/kor-install/backups/<install-id>
[]
```

`diff` of user settings against the recorded backup was empty both immediately after the local install and after uninstall, including with a pre-existing `"model": "opus"`. A separate fresh-HOME install/purge left no extra files or directories (path, type, mode and link-target diff empty). `kor uninstall --purge` also removes new Kor config, state and execution data; anything that predates this installation is restored from its backup. To purge after an ordinary uninstall removed the CLI link, run `node packages/cli/dist/cli.js uninstall --purge`. Do not remove a CLIProxyAPI key line until you are finished using it; proxy keys are managed manually. Kor never changes `~/.codex` or `~/.agents`.

Both commands support `--help` and `--json`. Invalid arguments produce the shared structured error format:

```text
$ kor uninstall --bogus --json
{"schemaVersion":1,"error":{"code":"invalid_arguments","message":"invalid command arguments","hint":"use kor uninstall [--purge] [--json]"}}
```

## Plan a Linear issue

Run a preflight for an issue identifier that you can read with the configured personal Linear key:

```sh
pnpm kor plan LEE-1101
```

The command prints the route, each decision, and its confidence. It writes redacted decision records to `~/.local/state/kor/kor.db`. A missing or invalid TypeSafe response keeps readiness `blocked` and marks the configured route `fallback`. A healthy but uncertain or non-applicable response keeps the route `escalated`, which is distinct from an outage. When a decision needs user input, Kor writes one stable-ID clarification comment to the Linear issue. The command exits one while readiness is blocked, a decision is escalated, or a fallback route is in use.

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

The preview includes the canonical issue UUID, title, intake label, default route, and these planned actions:

```text
enqueue durable assignment
run isolated session when kor serve is active
```

Run it without `--dry-run` to enqueue the canonical assignment and return its `executionId`. This daemon path owns the durable queue and execution status; its CLI does not perform the direct Linear progress writes from the standalone preflight command. `kor status --json EXECUTION-ID|ISSUE-ID`, `kor cancel EXECUTION-ID|ISSUE-ID`, and `kor retry EXECUTION-ID|ISSUE-ID` find the durable assignment locally, without a Linear request. Missing acceptance criteria produce `blocked` with a needs-input reason before a model session starts.

### Calibrate Jev routing against a baseline

Calibration is **Validated locally** through the daemon with a persistent SQLite store, restart/retry, and paired replay. Live Jev preflight and acceptance calls are **Validated**. The proof uses fixture Linear data and session generation, so gateway model execution and live Linear intake are not exercised by this proof.

After `pnpm install --frozen-lockfile` and `pnpm build`, configure `calibration.sampleRate` (default `0.25`) and `calibration.baselineRoute` in `~/.config/kor/config.yaml`. `kor serve` runs one Jev preflight over the verified model registry, and records the selected provider, model, label and decision ID for calibration. `kor serve --jev` additionally filters the candidates against the live gateway catalogue. Both modes use the same preflight and acceptance judge. Use `--no-calibration` to disable metrics and baseline runs, `--calibration-rate 1` to sample every Jev execution, or `--baseline-model MODEL` to override the comparison model for one process.

Sampling is stable per execution ID. A sampled baseline uses the same base revision, prompt, checks, acceptance judge and repair budget in a throwaway worktree; it never ships. Retries reuse the preflight audit and keep attempt costs, while clearing the previous terminal outcome until a new outcome is observed. An escalated, unavailable or no-longer-eligible route is labelled `fallback` and does not create a new Jev sample.

```sh
pnpm kor calibrate report
pnpm kor calibrate report --since 2026-10-01T00:00:00.000Z --json
pnpm calibration:proof              # offline daemon/retry proof
pnpm calibration:proof --live-jev   # runtime TypeSafe key; real preflight and acceptance calls
pnpm calibration:proof --fallback   # forced Jev outage; no external calls
```

Each proof prints a `report_command` for its own isolated state directory. Run that command to inspect its stored report. The live Jev run on 2026-10-14 produced:

```text
calibration:proof passed; mode=live-jev; daemon=true; preflight_calls=1; route=claude-sonnet-5-5; confidence=1.0000; arm=jev; pairs=1; retry=replayed; terminal_outcome=recorded

Kor calibration report
Completed Jev/baseline pairs: 1
Since: all time
Success = identical verification gate in both arms. Terminal merge outcomes are separate.
Metric	Jev-route (all)	baseline (sampled)	Paired delta (Jev - baseline)
Runs (finished/total)	1/1	1/1	1 pairs
Merged/terminal outcomes	1/1	0/0	n/a (baseline never ships)
successRate	1.0000 (n=1)	1.0000 (n=1)	0.0000 (n=1)
repairs	1.0000 (n=1)	0.0000 (n=1)	1.0000 (n=1)
costUsd	unavailable (n=0)	0.0400 (n=1)	unavailable (n=0)
cacheHitRate	unavailable (n=0)	0.3125 (n=1)	unavailable (n=0)
wallClockMs	305.0000 (n=1)	248.0000 (n=1)	57.0000 (n=1)
failovers	unavailable (n=0)	unavailable (n=0)	unavailable (n=0)
verificationFailures	0.0000 (n=1)	0.0000 (n=1)	0.0000 (n=1)
policyBlocks	unavailable (n=0)	0.0000 (n=1)	unavailable (n=0)
clarifications	unavailable (n=0)	unavailable (n=0)	unavailable (n=0)

Confidence calibration against terminal merge success (outcome proxy, not decision-correctness probability)
Kind	Bin	N	Mean signal	Observed success	Brier (proxy)
route	0.8–1.0	1	1.0000	1.0000	0.0000
readiness	0.8–1.0	1	0.9700	1.0000	0.0009
acceptance	0.8–1.0	1	0.8200	1.0000	0.0324
Route uses Choice confidence; readiness/acceptance use Noul probability. Missing outcomes excluded; final acceptance attempt only.
Fewer than 20 completed pairs; insufficient evidence to conclude routing wins.
```

The forced-outage run produced:

```text
calibration:proof passed; mode=forced-fallback; daemon=true; preflight_calls=1; route=claude-sonnet-5-5; confidence=0.0000; arm=fallback; pairs=0; retry=not-needed; terminal_outcome=recorded
```

The outage still launches the configured default route, but unavailable acceptance judgment leaves the execution blocked and records a rejected outcome. It creates no baseline and appears in the report's fallback column. The live proof deliberately crashes its first session, so missing cost/cache counters for that attempt remain `unavailable`; baseline cost and token counts are fixture telemetry. Jev confidence and acceptance probabilities above came from live calls, and wall-clock values vary.

Rejected, escalated, and abandoned outcomes are recorded by the controller. The shipping daemon records merged or rejected outcomes when it observes a PR merge or closure. The calibration proof invokes that hook locally; the shipping replay exercises the observation path with forge fixtures. Neither proof merges a real PR. Credentials are read at runtime and never printed or committed.

## Run the Kor daemon

After `kor install`, configure `~/.config/kor/config.yaml` and credentials, check `kor doctor`, then run `systemctl --user enable --now kor`. The installer generates the unit with the correct checkout and executable paths.
The daemon polls Todo issues carrying the configured `kor` label, stores leases in `~/.local/state/kor/kor.db`, and publishes snapshots under `~/.local/state/kor/snapshots/`.
It polls each repository's `linearTeam` (else the team part of its map key) and runs a claimed issue in the checkout `repositoryKeyForIssue` maps it to (`linearProject`, then `linearTeam`).
Use `kor status --json`, `kor run LEE-n` (a durable queue entry; the daemon writes Linear progress), `kor cancel EXECUTION-ID|ISSUE-ID`, `kor retry EXECUTION-ID|ISSUE-ID`, and `kor logs EXECUTION-ID`.
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

Run the committed offline replay after building:

```sh
pnpm build
pnpm shipping:proof
```

It exercises real Git, SQLite and HTTP, with external-service and cleanup fixtures.
The replay proves that shipping stages only verified paths, leaves a decoy
`.env.local` and unrelated files untracked, blocks sensitive paths already staged
or committed by a session, records calibration outcomes, and redacts/caps the public
PR content:

```text
publication proof: verified files committed; .env.local and unrelated file excluded; PR secrets/local paths redacted; body <= 60000 characters; literal filename preserved
sensitive-path proof: staged and session-committed .env.local blocked before publication
migration proof: v4 -> v5; execution/lease/metadata/outbox preserved; shipping not claimable; retry does not rerun verified work
```

The command prints its scratch directory for inspection. No credentials are needed.
The filename policy excludes common secret/config/log paths; it is not a content
secret scanner. Direct PR content strips credentials and local paths, and gated
delivery uses `--no-publish-intent` to keep the Linear description out of the public
Intent section.

## Open the live cockpit

The cockpit is the Claude Code mod in `packages/claude-plugin`. Before installing it, or when testing without changing a user configuration, load it in the sandboxed Claude Code with the daemon running:

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
