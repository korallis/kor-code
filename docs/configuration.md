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

`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_DATA_HOME` override those roots. `KOR_GATEWAY_KEY`, `KOR_GATEWAY_URL`, and the other supported environment variables override values in `gateway.env` for one process. Kor never edits CLIProxyAPI configuration and never prints credential values.

The YAML schema is:

```yaml
repos:
  team/project:
    path: /absolute/path/to/checkout
    remote: https://github.com/org/project.git
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

`defaultBranch` defaults to `main`, `checks` and `toolAllowlist` default to empty lists, and the default route is `anthropic / claude-sonnet-5-5` with fill-first account selection. Calibration samples one quarter of primary executions by a stable execution-id hash unless `calibration.sampleRate` is changed. The fixed baseline defaults to `claude-sonnet-5-5`; sampled baseline replays use the primary run's base revision in a throwaway worktree and never ship. Unknown fields and invalid values fail before a configuration reaches the controller.

Run `pnpm kor doctor` (or the installed `kor doctor`) for bounded checks of the credentials, CLIProxyAPI, management endpoint, quota-axi, Claude Code, no-mistakes, and every configured repository. A missing Kor client key reports the exact one-line proxy addition to make:

The doctor prints one generated key-list item, such as `CLIProxyAPI addition: - kor-<generated-value>`. Add that exact item to the proxy's `api-keys` list and put the same value in `KOR_GATEWAY_KEY` in `gateway.env`.

## Calibration

Calibration rows share `kor.db` with the daemon. Each Jev or baseline arm records one `run_metrics` row per attempt, including cost, token and cache counters, wall-clock time, failovers, verification failures, policy blocks, and clarifications. Terminal outcomes are recorded separately so a verified run is not reported as merged before the merge outcome exists.

Run the report with:

```sh
kor calibrate report
kor calibrate report --since 2026-10-01T00:00:00.000Z --json
```

The text report shows Jev and baseline arms side by side and a confidence reliability table with sample sizes and Brier scores. Fewer than 20 outcomes in either arm are labelled directional.
