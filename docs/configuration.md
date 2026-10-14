# Kor configuration

Kor keeps its machine-specific configuration outside a repository. The default paths follow XDG conventions:

- `~/.config/kor/config.yaml` — repository mappings and runtime policy.
- `~/.config/kor/gateway.env` — the Kor CLIProxyAPI client key and optional gateway URL. Keep this file mode `0600`.
- `~/.local/state/kor` — durable state, audit records, and snapshots.
- `~/.local/share/kor` — execution session homes and worktrees.

The daemon persists its queue and leases in `~/.local/state/kor/kor.db`. It writes
an atomic `snapshots/index.json` and one `<execution-id>.json` file per assignment.
`kor serve` exposes the same status envelope at `http://127.0.0.1:8327/status`.
Install the user unit with `kor install --pilot CHECKOUT`. Once the repository
mapping, credentials, checks and tool allowlist are configured, run:

```sh
kor doctor
systemctl --user enable --now kor
```

The response has `provenance: live`, `stale`, or `unavailable`. A missing snapshot
is unavailable; an old snapshot is stale and includes its age reason. The daemon
never treats unavailable data as an empty queue.

Each run in the status carries, when the daemon knows them, the Linear issue
(`issueKey`, `issueTitle`, `issueUrl`, `issueState`), the route in force with its
`routeSource` (`config`, `jev`, `fallback` when Jev escalated or was unavailable,
or `override`), and the IDs of its Jev decisions. The snapshot carries those
decisions (`decisions`), the gateway's account slots (`accounts`: opaque hashes,
refreshed on every poll; a failed read keeps the last pool as `stale`, or is
`unavailable`, with a `reason`), and the override audit (`overrides`). On an
execution's first attempt the daemon runs `kor plan`'s Jev preflight over the
verified models and records its decisions; an escalation or a Jev outage leaves
the configured default route, labelled `fallback`, and never fails the run.
Execution sessions receive `KOR_STATUS_URL` and `KOR_STATE_DIR`, so the cockpit
inside them reads this daemon.
The route handoff retains Jev's provider, model, label and `decisionId`; controller
metrics and terminal observations refer to that preflight audit. Retry replays the
same decision without another preflight, and rechecks that its model is eligible.
`--jev` filters candidates against the live gateway catalogue at startup; plain
`serve` reads the verified registry. Both modes use Jev for acceptance judgments,
which stay blocked during an outage even though execution uses the default route.

The cockpit posts overrides to `POST /overrides` (`{ executionId, target, choice }`,
`target` being `route` or a decision ID) and reverts them with
`POST /overrides/<id>/revert`; both accept local JSON requests only. Overrides are
recorded in the `override_audit` table of `kor.db`. The cockpit reads
`KOR_STATUS_URL` (default `http://127.0.0.1:8327/status`; `off` reads only the
snapshot), `KOR_STATE_DIR` (default `~/.local/state/kor`) and `KOR_COCKPIT=off`
(hides the status line).
Readers accept schema version 1 and ignore additive fields, while an unknown schema version or invalid required field is unavailable.
The CLI freshness threshold is the configured poll interval multiplied by two unless an explicit reader threshold is supplied.

`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_DATA_HOME` override those roots. `KOR_GATEWAY_KEY`, `KOR_GATEWAY_URL`, and the other supported environment variables override values in `gateway.env` for one process. Kor never edits CLIProxyAPI configuration. Install prints only a newly generated key for manual provisioning; it never prints existing credential values.

## Install and uninstall

Build with `pnpm install --frozen-lockfile && pnpm build`, then run
`node packages/cli/dist/cli.js install --pilot CHECKOUT`. The installed symlink at
`~/.local/bin/kor` points at the compiled CLI. Keep its source checkout available
and rebuild after updating it. The unit uses absolute paths to Node and the CLI,
the source checkout as its working directory, and the install's HOME, XDG roots
and PATH. Install reloads the user manager but leaves startup explicit.
`--no-systemd` writes the unit without contacting a user manager and records that
choice so uninstall also skips systemctl.

The default `--scope local` requires a standalone Git checkout root in `--pilot`.
Both the local-path marketplace and `kor-cockpit@kor` are declared in that
checkout's `.claude/settings.local.json`. Claude's edit to Git's global ignore
file (including a configured `core.excludesFile`) is backed up and restored too. The cache
and registries live under `CLAUDE_CONFIG_DIR` (default `~/.claude`). A linked Git
worktree is refused before mutation because Claude Code 2.1.299 resolves its
local settings through the primary checkout. Use a normal clone instead.

After pilot acceptance, run `kor uninstall` and then
`node packages/cli/dist/cli.js install --scope user`. Existing config and keys
are reused; `--pilot` is optional at user scope and defaults to the source
checkout for a new config scaffold. Configure `linearTeam` or `linearProject`,
checks, and `toolAllowlist` before enabling the service. Empty scaffold checks
and allowlists are deliberate placeholders for repository policy.

When no file or runtime credential is present, install writes a new
`KOR_GATEWAY_KEY=kor-...` to `gateway.env` (0600) and prints the matching
`CLIProxyAPI addition: - kor-...`. Add that line to CLIProxyAPI manually.
Pre-existing credentials are never printed, and runtime credentials are never
copied to disk. Kor does not modify the proxy, `~/.codex`, or `~/.agents`.

The recovery journal lives at `XDG_STATE_HOME/kor-install/manifest.json`
(default `~/.local/state/kor-install/manifest.json`), with private backups under
`kor-install/backups/<install-id>/`. Keeping it beside `kor` makes purge
recoverable. Entries contain paths, backup locations, before/after hashes
(including bytes, modes and symlink targets), and retention policy. Config,
state and share directories are backed up before initialization; account for
that disk space when reinstalling an existing runtime.

Normal uninstall stops and disables a systemd-managed unit, restores settings,
registries, the old CLI link and unit, and removes the marketplace/cache. It
retains Kor config, data and backups. Purge additionally restores pre-install
config/state/share contents, removing newly created data. It can also run after
normal uninstall, via the source CLI. An installation failure rolls back; an
interruption leaves a journal that `kor uninstall --purge` can replay.

Uninstall verifies backups and refuses changes to shared settings or registries
made since install before restoring anything. Compare the reported paths,
save later edits elsewhere, and resolve the conflict before retrying. It never
automatically overwrites those edits. Claude's transient `.claude.json` and
metadata backups are restored if unchanged since install; newer session
metadata is preserved. Empty parent directories created by install are removed
only when still empty. After normal uninstall, a later purge touches retained
Kor data only, preserving any new Claude settings changes.

Validated with real Claude plugin commands and cockpit loading in a standalone
sandbox clone: local settings stayed local, user settings compared equal to
the backup, uninstall left `claude plugin list --json` empty, user-scope install
worked, and purge restored pre-existing bytes, modes and symlinks. The generated
unit passed `systemd-analyze --user verify`; systemctl sequencing was checked
with a shim, not the shared real user manager. No live gateway key was used.

The YAML schema is:

```yaml
repos:
  team/project:
    path: /absolute/path/to/checkout
    remote: https://github.com/org/project.git
    linearTeam: LEE
    linearProject: 00000000-0000-0000-0000-000000000000
    defaultBranch: main
    checks:
      - pnpm typecheck
      - pnpm test
    toolAllowlist:
      - Read
      - Write
      - Edit
      - "Bash(git status*)"
limits:
  total: 2
  perRepository: 1
  perProvider: 2
defaultRoute:
  provider: anthropic
  model: claude-sonnet-5-5
  accountPolicy: fill-first
  sessionAffinity: true
  reasoningLevel: medium
pollIntervalSeconds: 60
intakeLabel: kor
calibration:
  sampleRate: 0.25
  baselineRoute:
    provider: anthropic
    model: claude-sonnet-5-5
    accountPolicy: fill-first
    sessionAffinity: true
    reasoningLevel: medium
```

`defaultBranch` defaults to `main`, `checks` and `toolAllowlist` default to empty lists, and the default route is `anthropic / claude-sonnet-5-5` with fill-first account selection. Unknown fields and invalid values fail before a configuration reaches the controller.

`linearTeam` and `linearProject` map a Linear issue to this repository. `linearProject` wins when both match; otherwise Kor uses the team mapping. A repository key that exactly matches the issue's team key or project ID is also accepted for small pilots.

Use `kor run LEE-123 --dry-run` to read a Todo issue and its team's workflow states, resolve the configured repository, and print the exact state and comment writes without changing Linear. The live command applies the same writes with a deterministic UUID v4 comment ID, so retrying it updates or reuses the existing progress comment. `kor cancel LEE-123` writes Todo and a deterministic cancellation comment. Agent-session mutations remain disabled for a personal key; they require the later OAuth app capability.

Run `pnpm kor doctor` (or the installed `kor doctor`) for bounded checks of the credentials, CLIProxyAPI, management endpoint, quota-axi, Claude Code, no-mistakes, and every configured repository. A missing Kor client key reports the exact one-line proxy addition to make:

The doctor prints one generated key-list item, such as `CLIProxyAPI addition: - kor-<generated-value>`. Add that exact item to the proxy's `api-keys` list and put the same value in `KOR_GATEWAY_KEY` in `gateway.env`.


## Calibration

Calibration rows share `kor.db` with the daemon. Each Jev or baseline arm records one `run_metrics` row per attempt, including cost, token and cache counters, wall-clock time, failovers, verification failures, policy blocks, and clarifications. Terminal outcomes are recorded separately; the product observes rejected, escalated, and abandoned outcomes, while merge observation remains a T6 integration point. Outcome recording updates the persisted preflight audit even when the controller did not select the route itself. A retry clears its stale terminal outcome and decision observations while retaining all attempts. Its run records the route actually used on retry; a lost model or operator override cannot remain in the Jev sample.

Run the report with:

```sh
kor calibrate report
kor calibrate report --since 2026-10-01T00:00:00.000Z --json
```

The text report shows Jev and baseline arms side by side and a confidence reliability table with sample sizes and Brier scores. Fewer than 20 completed pairs are labelled directional. Clarifications remain unavailable until the clarification path supplies them; failovers use the provider API error signal when present.


`kor serve --calibration-rate RATE` overrides sampling for that process (0–1).
`--baseline-model MODEL` overrides the fixed comparison model; `--no-calibration`
disables metrics and paired replays while retaining preflight and acceptance audit.
Only Jev-labelled primary executions are sampled. A fallback is shown separately
and never represented as a successful Jev route.

`pnpm calibration:proof` exercises the actual daemon handoff with fixture responses.
`pnpm calibration:proof --live-jev` uses the runtime TypeSafe key for preflight and
acceptance; `--fallback` forces an outage without external calls. Each run prints
its own report command. Both retain fixture Linear data and session generation.
