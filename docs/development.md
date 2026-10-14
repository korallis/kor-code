# Development and validation

This page is for people working on Kor itself: the workspace layout, the
isolation guarantees, and the proof commands that exercise each part of the
product. For using Kor, read the [README](../README.md) and the
[user guide](user-guide.md).

Status words used in the design documents:

- **Proposed** means a direction was chosen, but no implementation evidence exists.
- **Validated** means a local or integration check supports the statement.
- **Blocked** means an external account, provider, or product behaviour prevents validation.
- **Illustrative** means a mock value or UI state, not live telemetry.
- **Verified** means a model passed the recorded sandbox compatibility probe and is routable.

## Foundation

The TypeScript pnpm workspace contains `core`, `jev`, `gateway-adapter`, `linear`, `controller`, `context`, `verification`, `config`, `cli`, and `claude-plugin` packages. Run `pnpm probe` for the external contract checks and read the [Phase 0 probe record](phase-0-probe.md). Use `scripts/sandbox.sh` to load the Claude Code plugin in a disposable `CLAUDE_CONFIG_DIR`; it never installs the plugin globally or changes the existing Claude Code configuration, runs offline unless `--live-model` opts in to CLIProxyAPI, and `pnpm isolation:proof` traces the sandboxed session to show it never touches the real Claude, Codex or agents homes or port 8317.

`pnpm typecheck` runs Claude's plugin validator in a throwaway HOME and configuration directory, so validation cannot migrate your user settings. To run the validator alone:

```sh
bash scripts/validate-plugin.sh packages/claude-plugin
```

The isolated run ended with `✔ Validation passed`; its caller's `opus` settings and file inventory stayed unchanged. See [validation isolation](../ISOLATION.md#plugin-validation).

The reversible installer is Validated in a disposable HOME and XDG tree for both local pilot and user scope. It stages Claude Code's local-path marketplace commands in a private HOME, publishes only Kor entries, restores the exact settings bytes on uninstall, and leaves `claude plugin list --json` without Kor. The revision proof used an `opus` user setting, a linked sandbox worktree, and an unrelated plugin refresh; uninstall preserved that plugin and its updated registry entries. The proof used the offline endpoint and no live gateway key. It validated the generated unit with `systemd-analyze --user verify`; systemctl sequencing used a command shim, so service lifecycle on the real user manager remains unvalidated.

The Phase 6 cockpit (`packages/claude-plugin`) is Validated on a live daemon run: `/kor` draws the daemon's status with LIVE, STALE and UNAVAILABLE labels, `/kor override` sends overrides to the daemon, and `/kor demo` keeps the fixture execution, which `pnpm cockpit:proof` replays (see [Open the live cockpit](user-guide.md#the-cockpit)). Execution sessions are Validated locally with parsed stream-json telemetry and policy checks; `pnpm e2e:live` runs the scratch-repository hello-file check when supplied a runtime `KOR_GATEWAY_KEY` or `KOR_GATEWAY_KEY_FILE` (without a key it reports the external validation as Blocked and makes no provider call). Sessions use `dontAsk` with an explicit repository tool allowlist, so removing `Write` produces a permission denial and a failed attempt. See the [cockpit specification](specs/cockpit-mockups.md).

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
KOR_E2E_DIR=/tmp/kor-e2e-live-success pnpm e2e:live
```

The command creates a scratch repository, creates a `kor/e2e-*` branch, commits `hello.txt`, and prints the selected model and cost. A successful run produced:

```text
e2e:live passed; branch=kor/e2e-1791974354926; hello=yes; committed=yes; model=claude-haiku-4-5-20251001; cost_usd=0.04701935; duration_ms=5450; permission_denials=0
```

Remove `Write` from the allowlist to check the failure path:

```sh
KOR_E2E_DIR=/tmp/kor-e2e-live-denial \
KOR_E2E_ALLOWED_TOOLS='Read,Edit,Bash(git status *),Bash(git add *),Bash(git commit *)' \
KOR_E2E_EXPECT_FAILURE=1 pnpm e2e:live
```

The session then reports permission denials and does not report success:

```text
e2e:live failed; branch=kor/e2e-1791974375194; hello=no; committed=no; model=claude-haiku-4-5-20251001; cost_usd=0.05174289999999999; duration_ms=8983; permission_denials=2
e2e:live failure=2 permission denials
```


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

## The daemon

The local daemon proof exercises intake, the loopback endpoint, lease renewal during an 800 ms run with a 200 ms lease, restart recovery, queued and running cancellation, terminal failure and retry, orphan worktree cleanup, and PID identity protection:

```text
$ pnpm daemon:proof
daemon proof passed; picked=LEE-57; status=live; restart=queued; attempts=1; orphan=removed; lease=exclusive; cancel=terminal; failure=retryable; pid-guard=pass
```

No live Linear or gateway credential was used for this proof; credentials are supplied at runtime by the configured environment.

### Shipping

The delivery flow is described in the [user guide](user-guide.md#what-happens-after-the-checks-pass) and the [shipping specification](specs/shipping.md).

The shipping flow is **Validated locally** for real Git, SQLite, HTTP snapshots,
and live Jev judgments; the gate, forge and Linear writes, and cleanup are
**Illustrative contract replays**. A live initialized-repository run against GitHub has not
been captured yet. See the [shipping specification](specs/shipping.md)
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

## Cockpit proof

The cockpit (`packages/claude-plugin`) is a Claude Code mod. `pnpm cockpit:proof` replays the fixture execution that `/kor demo` draws, and `pnpm cockpit` loads the plugin into a disposable Claude Code configuration for interactive use. See the [cockpit specification](specs/cockpit-mockups.md) and the [user guide](user-guide.md#the-cockpit).
