# Kor configuration

Kor keeps its machine-specific configuration outside a repository. The default paths follow XDG conventions:

- `~/.config/kor/config.yaml` — repository mappings and runtime policy.
- `~/.config/kor/gateway.env` — the Kor CLIProxyAPI client key and optional gateway URL. Keep this file mode `0600`.
- `~/.local/state/kor` — durable state, audit records, and snapshots.
- `~/.local/share/kor` — execution session homes and worktrees.

The daemon persists its queue and leases in `~/.local/state/kor/kor.db`. It writes
an atomic `snapshots/index.json` and one `<execution-id>.json` file per assignment.
`kor serve` exposes the same status envelope at `http://127.0.0.1:8327/status`.
Install the user unit from `systemd/kor.service` after the CLI is available:

```sh
mkdir -p ~/.config/systemd/user
cp systemd/kor.service ~/.config/systemd/user/kor.service
systemctl --user daemon-reload
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

The cockpit posts overrides to `POST /overrides` (`{ executionId, target, choice }`,
`target` being `route` or a decision ID) and reverts them with
`POST /overrides/<id>/revert`; both accept local JSON requests only. Overrides are
recorded in the `override_audit` table of `kor.db`. The cockpit reads
`KOR_STATUS_URL` (default `http://127.0.0.1:8327/status`; `off` reads only the
snapshot), `KOR_STATE_DIR` (default `~/.local/state/kor`) and `KOR_COCKPIT=off`
(hides the status line).
Readers accept schema version 1 and ignore additive fields, while an unknown schema version or invalid required field is unavailable.
The CLI freshness threshold is the configured poll interval multiplied by two unless an explicit reader threshold is supplied.

`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_DATA_HOME` override those roots. `KOR_GATEWAY_KEY`, `KOR_GATEWAY_URL`, and the other supported environment variables override values in `gateway.env` for one process. Kor never edits CLIProxyAPI configuration and never prints credential values.

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

Calibration rows share `kor.db` with the daemon. Each Jev or baseline arm records one `run_metrics` row per attempt, including cost, token and cache counters, wall-clock time, failovers, verification failures, policy blocks, and clarifications. Terminal outcomes are recorded separately; the product observes rejected, escalated, and abandoned outcomes, while merge observation remains a T6 integration point.

Run the report with:

```sh
kor calibrate report
kor calibrate report --since 2026-10-01T00:00:00.000Z --json
```

The text report shows Jev and baseline arms side by side and a confidence reliability table with sample sizes and Brier scores. Fewer than 20 completed pairs are labelled directional. Clarifications remain unavailable until the clarification path supplies them; failovers use the provider API error signal when present.
