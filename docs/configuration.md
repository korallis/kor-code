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
same decision while issue intent, blocking dependencies and eligible models are
unchanged, and rechecks that its model is eligible. Changed inputs create a fresh
immutable preflight revision while retaining earlier decisions. With calibration
enabled, recorded attempt metrics retain provider-reported costs, which may be unknown.
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

## Session launch profile

Set the top-level `launchProfile` in `config.yaml` to `lean` (the default) or
`standard`, then restart `kor serve` to use it for subsequent sessions.

```yaml
launchProfile: lean
```

Both profiles use the repository tool policy, disable automatic memory and
repository instruction discovery, and load the cockpit plugin. `lean` additionally
sets `includeGitInstructions: false` and `disableBundledSkills: true` in Claude
Code’s `--settings` JSON and passes `--exclude-dynamic-system-prompt-sections`.
This removes built-in commit/PR guidance and bundled skills and stabilizes the
system prefix across execution homes. `standard` retains the P1-1 settings for
A/B measurement. These flags apply only to isolated execution sessions.

The profile does not change Jev’s per-task route. Embedders can pass the same
`launchProfile` option to `SessionLauncher`; an explicit `args` override still
replaces the generated Claude arguments. See [Measure session context](context-bench.md)
for repeatable comparisons and cache measurements.

## Install and uninstall

Build with `pnpm install --frozen-lockfile && pnpm build`, then run
`node packages/cli/dist/cli.js install --pilot CHECKOUT`. The installed symlink at
`~/.local/bin/kor` points at the compiled CLI. Keep its source checkout available
and rebuild after updating it. The unit uses absolute paths to Node and the CLI,
the source checkout as its working directory, and the install's HOME, XDG roots
and a fixed PATH (the home's `.local/bin` and `.npm-global/bin`, Node's directory,
and system binary directories). Installer PATH shims are not embedded in the
service. Install reloads the user manager but leaves startup explicit.
`--no-systemd` writes the unit without contacting a user manager and records that
choice so uninstall also skips systemctl.

The default `--scope local` requires a standalone Git checkout root in `--pilot`.
Both the local-path marketplace and `kor-cockpit@kor` are declared in that
checkout's `.claude/settings.local.json`. The pilot's `.git/info/exclude` gets
an ignore rule for that local settings file, backed up and restored on uninstall;
Git's global ignore file is not changed by the installer. The cache and registries
live under `CLAUDE_CONFIG_DIR` (default `~/.claude`). A linked Git worktree is
refused before mutation because Claude Code 2.1.299 resolves its local settings
through the primary checkout. Use a normal clone instead.

Claude's plugin commands run in a private staging HOME and temporary Git root.
The installer copies their cache and publishes only Kor's settings and registry
entries into the actual locations. Local scope never writes user `settings.json`,
even when Claude would migrate `opus` to `opus[1m]`; user scope adds only Kor's
settings keys and preserves the other values. User session metadata is outside
installation ownership: neither `~/.claude.json` (without `CLAUDE_CONFIG_DIR`)
nor `CLAUDE_CONFIG_DIR/.claude.json` is read or rewritten by installation.

The installed local plugin pins the canonical pilot directory. Every command,
UI and policy hook, plus polling, checks the actual session directory before
acting. Start Claude at the pilot root; other directories, including linked
worktrees that inherit its settings, do not activate the cockpit. Claude may
still list the inherited registration there. User-scope and explicit sandbox
plugin loads have no pilot restriction.

After pilot acceptance, run `kor uninstall` and then
`node packages/cli/dist/cli.js install --scope user`. Existing config and keys
are reused; `--pilot` is optional at user scope and defaults to the source
checkout for a new config scaffold. Configure `linearTeam` or `linearProject`,
checks, and `toolAllowlist` before enabling the service. Empty scaffold checks
and allowlists are deliberate placeholders for repository policy.

Kor adds exact simple commands from `checks` to execution-session permissions. It
also permits equivalent direct invocations of explicitly allowed `bash`/`sh`
scripts when they are executable, use the same shebang interpreter, and resolve
inside the isolated execution worktree. These aliases preserve the configured
script and argument scope; they do not enable general shell or network commands.
By default Kor passes `--tools` with the deduplicated, sorted base tool names
from these effective permissions. For example,
`Bash(git diff*)` contributes `Bash`, while its command restriction stays in
`--allowedTools`. When `toolAllowlist` includes unscoped `Read`, Kor also
pre-approves `Glob` and `Grep` for file search. A scoped `Read(...)` or empty
allowlist does not receive automatic search tools or search permissions. To
permit search with a scoped policy, configure explicit scoped `Glob(...)` and
`Grep(...)` permissions in `toolAllowlist`.

Set `tools:` within a repository to cap the available tool set:

```yaml
tools: [Read, Write, Edit, Bash, Glob, Grep]
```

Values must be base tool names, not permission patterns (`Bash`, not
`Bash(git diff*)`). An omitted `tools` derives the ceiling from effective
permissions; `tools: []` exposes no tools. An override can deliberately omit
search. For controller sessions the ceiling is intersected with permission base
names, so a `tools` entry alone cannot make a policy-denied tool available.
Command permissions still come from `toolAllowlist` and exact simple checks.
Automatic search permission still requires unscoped `Read` and an available
search tool. Executable-script aliases are resolved in the actual worktree.

Before each initial or repair session, Jev answers four independent Nouls in
one request: shell beyond read-only git, live browser, external web evidence,
and sub-agents. Ordinary tools remain available within the ceiling, typically
`Read, Write, Edit, Bash, Glob, Grep`. The shell answer is recorded without
removing `Bash`, because even a docs task may need permitted git inspection.
It never expands command permissions.

`WebFetch`, `WebSearch`, `Agent` and browser tool names under
`mcp__chrome_devtools__`, `mcp__playwright__` or `mcp__browser__` are optional.
They require a yes probability of at least **0.8** and a matching permission
base name. For example, add `WebFetch` to `toolAllowlist` (and to `tools` if
configured) to make it eligible for research tasks. A docs task does not pay
for that schema. Browser judgments select only policy-named tools; this does
not configure an MCP server or install browser tooling.

Missing Jev, low probabilities or an outage leave optional tools off. Outages
are labelled in the decision audit. Tool decisions use immutable IDs keyed by
execution, task and effective policy; unchanged retries replay them without an
API call, while repair prompts or policy changes produce new decisions.
`kor doctor` shows the configured ceiling, before task selection. The session's
actual tool list and the `tools` decisions show what was selected. Routing
remains Jev's separate per-task decision.

The session prompt lists its available tools and effective permissions. Denied
calls and their actual tool output are recorded for Jev to distinguish missing required work from an
optional inspection that was denied.

When no file or runtime credential is present, install writes a new
`KOR_GATEWAY_KEY=kor-...` to `gateway.env` (0600) and prints the matching
`CLIProxyAPI addition: - kor-...`. Add that line to CLIProxyAPI manually.
Pre-existing credentials are never printed, and runtime credentials are never
copied to disk. Kor does not modify the proxy, `~/.codex`, or `~/.agents`.

The recovery journal lives at `XDG_STATE_HOME/kor-install/manifest.json`
(default `~/.local/state/kor-install/manifest.json`), with private backups under
`kor-install/backups/<install-id>/`. Keeping it beside `kor` makes purge
recoverable. Entries contain paths, backup locations, before/after hashes
(including bytes, modes and symlink targets), installed-byte snapshots for
shared files, and retention policy. Config, state and share directories are backed up before initialization; account for
that disk space when reinstalling an existing runtime.

Normal uninstall stops and disables a systemd-managed unit, restores settings,
the old CLI link and unit, and removes the marketplace/cache. It deletes only
Kor's entries from current registries, retaining unrelated plugins and marketplace
refreshes; if the remaining content equals the original, it restores its exact
backup bytes. It retains Kor config, data and backups. Purge additionally restores pre-install
config/state/share contents, removing newly created data. It can also run after
normal uninstall, via the source CLI. An installation failure rolls back; an
interruption leaves a journal that `kor uninstall --purge` can replay.

Uninstall verifies backups before restoring anything. Unrelated shared settings
edits stop it and identify the current file, the original backup (or absence),
and the installed snapshot. Save your edits, restore that installed snapshot,
then retry. Automatic JSON reformatting and Claude's known `opus` alias migration
are accepted, restoring the original bytes and modes. Other value or mode changes
still stop restoration. Session metadata created by later Claude sessions is
left alone.

Empty parent directories created by installation, including the journal's parents
and Claude's marketplace directory, are removed when still empty. A fresh-HOME
install followed by purge leaves no directory leftovers. After normal uninstall,
a later purge touches retained Kor data only, preserving new Claude settings.
A subsequent successful install replaces the restored installation's backups;
failed attempts keep the recovery journal.

Validated with real Claude plugin commands and cockpit loading in a standalone
sandbox clone with an `opus` user setting: user settings compared equal to the
backup immediately after installation and after uninstall; the cockpit activated
in the pilot but not its linked worktree. After real sessions rewrote the Kor
registry and another plugin's marketplace refreshed, uninstall removed Kor and
preserved that plugin. User-scope installation also worked. A separate fresh-HOME
purge restored the complete path/type/mode/link inventory without leftovers. The generated unit passed `systemd-analyze --user verify`; systemctl sequencing was checked
with a shim, not the shared real user manager. No live gateway key was used.

## Skill catalogue sources

The optional `skills` block configures catalogue sources and warning budgets:

```yaml
skills:
  privatePath: ~/private-guidance
  packs: [~/skill-packs/frontend]
  jev: names-only
  listingBudget: 8000
  bodyBudget: 2000
```

Without it, Kor reads its bundled skills and the optional
`XDG_CONFIG_HOME/kor/skills/` private directory. Extra pack paths and an explicit
private path must exist. Relative paths resolve from `config.yaml`; `~` means
the current Kor home. Private descriptions stay out of the selection view unless
`jev: full`; a skill marked `local-only` remains restricted. `kor skills index`
writes the merged catalogue under `XDG_STATE_HOME/kor/skills/catalogue.json`.
See [the catalogue contract](skills.md#catalogue) for counting, deduplication,
name collisions, visibility and the read-only `--from` scan.

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

`defaultBranch` defaults to `main`, `checks` and `toolAllowlist` default to empty lists, `tools` is derived when omitted, and the default route is `anthropic / claude-sonnet-5-5` with fill-first account selection. Unknown fields and invalid values fail before a configuration reaches the controller.

`linearTeam` and `linearProject` map a Linear issue to this repository. `linearProject` wins when both match; otherwise Kor uses the team mapping. A repository key that exactly matches the issue's team key or project ID is also accepted for small pilots.

Use `kor run LEE-123 --dry-run` to resolve a Linear issue and preview the queue operation without writing anything. It prints the issue's canonical UUID and title, the intake label, the default route, and the planned actions (`enqueue durable assignment`, `run isolated session when kor serve is active`). It fails with `No Kor repository mapping for Linear team …` when `config.yaml` has no repository for the issue's team or project, and it does not check the issue's state. `kor run LEE-123` enqueues the assignment and prints its `executionId`; the daemon claims it and writes the Linear progress, using deterministic comment IDs so a retry updates or reuses the existing comment. `kor cancel` and `kor retry` change only Kor's queue: a cancelled execution's Linear issue is not moved back to Todo, so do that in Linear. Agent-session mutations remain disabled for a personal key; they require the later OAuth app capability.

Run `kor doctor` (or `pnpm kor doctor`) for bounded checks of the credentials, CLIProxyAPI, management endpoint, quota-axi, Claude Code, no-mistakes, and every configured repository. Only the config, the keys, the gateway, Claude Code and the repositories are needed to run and verify an issue; the management endpoint and quota-axi feed the cockpit's account panel, and the no-mistakes daemon is needed for delivery. A missing Kor client key reports the exact one-line proxy addition to make:

```text
FAIL CLIProxyAPI with Kor key: missing; CLIProxyAPI addition: - kor-<generated-value>
```

Add that exact item to the proxy's `api-keys` list and put the same value in `KOR_GATEWAY_KEY` in `gateway.env`. The [user guide](user-guide.md#check-your-setup-with-kor-doctor) shows the whole output.


## Calibration

Calibration rows share `kor.db` with the daemon. Each Jev or baseline arm records one `run_metrics` row per attempt, including cost, token and cache counters, wall-clock time, failovers, verification failures, policy blocks, and clarifications. Terminal outcomes are recorded separately; the controller records rejected, escalated, and abandoned outcomes, and the shipping daemon records merged or rejected outcomes when it observes a pull request merge or closure. Outcome recording updates the persisted preflight audit even when the controller did not select the route itself. A retry clears its stale terminal outcome and decision observations while retaining all attempts. Its run records the route actually used on retry; a lost model or operator override cannot remain in the Jev sample.

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
