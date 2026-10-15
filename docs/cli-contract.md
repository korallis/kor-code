# CLI contract

Kor's command line is meant to be scripted as well as typed. This page is the
vendor-neutral contract for anything that wraps `kor`: a shell script, a CI job,
a dashboard, or another orchestrator. It covers the JSON that `kor run`,
`kor status`, `kor cancel` and `kor retry` print, and the error format shared by
every command.

All outputs on this page were captured from a real `kor serve` daemon and the
installed `kor` command, using a throwaway `HOME`. `schemaVersion` is `1`
throughout. A reader must reject a `schemaVersion` it does not know and ignore
fields it does not recognise, because new fields are added without a version
bump.

## Running it from a script

`kor skills lint [DIRECTORY] [--json]` is a local, read-only command with no
daemon or credential requirement. Its report schema, diagnostic rules and token
estimates are documented in [Public skills](skills.md#output-and-proof). It uses
the standard `0`/`1`/`2` exit codes and shared CLI errors for I/O failures.

`kor skills index|list|doctor [--from DIRECTORY]... [--estimate] [--json]` and
`kor skills show NAME` inspect the merged catalogue without a daemon. Only
`index` writes state; errors preserve the last catalogue. Their versioned JSON
shapes, hashes, source configuration and budgets are documented in
[Catalogue](skills.md#catalogue). `show` accepts the same flags.

- Use the installed `kor` (or `bin/kor` from the checkout). Both print clean
  JSON on stdout. `pnpm kor` prints pnpm build output before the command's own
  output and is meant for interactive use.
- The daemon and the CLI must share one `HOME` or the same `XDG_CONFIG_HOME`,
  `XDG_STATE_HOME` and `XDG_DATA_HOME`. They exchange state through
  `kor.db` and `snapshots/` under the state directory.
- Do not start `kor serve` from a script on every poll. The daemon is a
  long-running process (`systemctl --user enable --now kor`, or a terminal).
- Exit codes: `0` success, `1` the command ran and failed, `2` the arguments were
  wrong (a usage error). Two commands deviate for usage errors: `kor calibrate`
  and `kor models` report a wrong argument as `command_failed` with exit `1`.
- `--json` is accepted by `run`, `status`, `cancel`, `retry`, `logs`, `doctor`,
  `plan`, `install`, `uninstall`, `linear lint`, `linear attach-image`, `skills lint` and
  `calibrate report`, and a failure of any command is reported as a JSON error
  object when `--json` is present (see
  [Errors](#errors)). Only some commands print JSON on success: `run`, `status`,
  `cancel`, `retry`, `logs`, `doctor`, `plan`, `install`, `uninstall`,
  `linear lint`, `linear attach-image` and `skills lint` do.
  `kor models list` and `kor models probe` always print a table, and `kor
  calibrate report` prints its text report unless you pass `--json` to get
  the report object.

## Attach a PNG: `kor linear attach-image ISSUE FILE --alt CAPTION [--json]`

This is an explicit host-side Linear write, independent of the daemon and
repository mapping. It creates an image attachment, adds a Markdown image under
`## Screens`, and verifies the saved issue and authenticated image bytes.

| JSON field | Meaning |
| --- | --- |
| `schemaVersion` | `1`. |
| `issue` | Canonical Linear issue identifier. |
| `attachmentId` | Stable ID derived from issue UUID, PNG content and normalized caption. |
| `bytes` | Verified downloaded byte count. |
| `sha256` | Digest matching the source PNG and downloaded asset. |
| `verified` | `true` after description, attachment and byte readback pass. |

Signed URLs and credentials are omitted. Repeat the same inputs to resume a
partial write. Changing the caption or bytes creates another attachment.
Failures can leave a partial remote write; description updates are not atomic
with attachment creation. See [PNG uploads](skills.md#linear-skills-and-png-uploads)
for credentials, file limits, retries and concurrent-edit limitations. Invalid
arguments exit `2`; runtime, file and API failures exit `1` with the shared error
shape. A verified operation exits `0`.

## Queue an issue: `kor run ISSUE-ID --json`

`kor run` resolves the issue through Linear, checks the repository mapping, and
writes a durable assignment. It does not start work itself; the daemon claims the
assignment.

```text
$ kor run LEE-1115
{
  "schemaVersion": 1,
  "issueId": "LEE-1115",
  "canonicalIssueId": "f1549beb-5bfa-40cf-a98a-52dc4798b26d",
  "executionId": "2733a7bf-4662-4f26-8c1f-c6d9746b6d88",
  "status": "queued",
  "queued": true
}
```

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1`. |
| `issueId` | The Linear key you passed, for example `LEE-1115`. |
| `canonicalIssueId` | The issue's Linear UUID. Manual runs and daemon polling address the same assignment through it. |
| `executionId` | The durable execution ID. Use it with `status`, `cancel`, `retry` and `logs`. |
| `status` | The assignment's current state. |
| `queued` | `true` when the assignment is waiting for the daemon. Running the command again for the same issue returns the same `executionId`; `queued` describes the current state, not a new run. |

`kor run ISSUE-ID --dry-run` resolves the issue and prints what would be queued.
It creates no execution, so it has no `executionId`, and its output has no
`schemaVersion`:

```text
$ kor run LEE-1117 --dry-run
{
  "issueId": "LEE-1117",
  "canonicalIssueId": "bfbb1847-7f14-469d-8ef8-4efcbf8e80fd",
  "title": "[throwaway] Kor README capture: add a question function",
  "dryRun": true,
  "intake": "kor",
  "route": {
    "provider": "anthropic",
    "model": "claude-haiku-5-5",
    "accountPolicy": "fill-first",
    "sessionAffinity": true,
    "reasoningLevel": "medium"
  },
  "planned": [
    "enqueue durable assignment",
    "run isolated session when kor serve is active"
  ]
}
```

## Read one execution: `kor status --json EXECUTION-ID|ISSUE-ID`

The selector may be an execution UUID, the Linear UUID, or a stored issue key such
as `LEE-1111`. Selecting an execution reads Kor's local database and does not
contact Linear.

```text
$ kor status --json LEE-1111
{
  "schemaVersion": 1,
  "provenance": "live",
  "observedAt": "2026-10-14T18:00:06.869Z",
  "run": {
    "executionId": "cd1e6aa4-be39-466f-8d69-eb4b8687dfaf",
    "issueId": "d8028008-c8b4-47a3-8b64-c00770784e73",
    "issueKey": "LEE-1111",
    "state": "blocked",
    "attempts": 1,
    "cancelRequested": false,
    "pullRequestUrl": null,
    "needsInput": {
      "reason": "git failed (2): error: No such remote 'origin'\n"
    },
    "costUsd": null
  }
}
```

| Field | Meaning |
| --- | --- |
| `provenance` | `live`: the daemon that owns the execution is running and its snapshot is fresh. `stale`: the daemon is not running, or its snapshot is older than twice the poll interval; the `run` is the last durable record. `unavailable`: see below. |
| `observedAt` | When the CLI read the record (UTC). |
| `reason` | Present when `provenance` is `stale` or `unavailable`. |
| `run.executionId`, `run.issueId`, `run.issueKey` | The durable execution ID, the Linear UUID, and the issue key (nullable for old assignments). |
| `run.state` | The queue state: `queued`, `running`, `shipping`, `review`, `complete`, `failed`, `blocked` or `canceled`. Treat an unknown future state as "not finished". |
| `run.attempts` | How many times the daemon has claimed this execution. A restart or `kor retry` adds one. |
| `run.cancelRequested` | A cancellation is waiting for the running session to stop. |
| `run.pullRequestUrl` | The pull request, or `null` until shipping has opened one. |
| `run.needsInput` | `{ "reason": "…" }` for a blocked execution, otherwise `null`. |
| `run.costUsd` | Reported cost, or `null` when no telemetry has been published. `null` is never zero spend. |
| `run.errorCode` | Optional classification of a block, for example `needs_input` (no acceptance criteria) or `verification_blocked`. |

`complete` means the daemon observed that the pull request was merged. Kor never
merges. A `stale` observation is not a failure: show the record and keep
polling. If the owning daemon is stopped, the selected-execution form is `stale`
immediately.

When nothing matches the selector, or there is no database, the response has
`provenance: "unavailable"`, `run: null`, a `reason`, and an `error` object, and
the exit code is `1` (the no-database variant is under
[Unavailable status](#unavailable-status)):

```text
$ kor status nope --json
{
  "schemaVersion": 1,
  "provenance": "unavailable",
  "observedAt": "2026-10-14T17:59:58.333Z",
  "run": null,
  "reason": "execution not found",
  "error": {
    "code": "execution_not_found",
    "message": "execution not found",
    "hint": "check the execution ID, issue ID, or stored issue key"
  }
}
```

`kor status` always prints JSON; `--json` only changes how a failure is reported.

## Read everything: `kor status --json`

With no selector, `kor status` prints an envelope around the daemon's snapshot.
The same envelope is served at `http://127.0.0.1:8327/status`. The file the daemon
writes to disk, `snapshots/index.json` in the state directory, is **not** the
envelope: it is only the inner snapshot (the object under `snapshot`), with no
`provenance` and no outer `schemaVersion`/`observedAt` envelope. A program that
reads the file must compute freshness itself from `observedAt`; the CLI and HTTP
endpoint do that for you.

```text
$ kor status --json | jq -c 'keys'
["observedAt","provenance","schemaVersion","snapshot"]
$ kor status --json | jq -c '.snapshot | keys'
["accounts","daemon","decisions","observedAt","overrides","runs","schemaVersion"]
$ kor status --json | jq -c '.snapshot.runs[0] | keys'
["attempts","branch","decisionIds","error","errorCode","executionId","issueId","issueKey","issueState","issueTitle","issueUrl","observedAt","phase","repository","route","routeSource","shipping","status","verification","worktree"]
```

| Snapshot field | Meaning |
| --- | --- |
| `daemon` | `pid`, `startedAt`, `pollIntervalSeconds`, `lastPollAt`. |
| `runs[]` | One entry per execution: its `status`, `attempts`, the Linear issue (`issueKey`, `issueTitle`, `issueUrl`, `issueState`), the `route` in force with its `routeSource` (`config`, `jev`, `fallback` or `override`), `decisionIds`, `verification` (each attempt's checks, diff and per-criterion findings), `shipping`, the `branch` and `worktree`, and `error` when blocked or failed. |
| `accounts`, `decisions` | Each is `{ value, provenance, observedAt }`, plus `reason` when it could not be read. `provenance` is `live`, `stale` or `unavailable`. `accounts` can be missing from the very first snapshot a daemon publishes, before its first account refresh. |
| `overrides` | The audit of cockpit overrides. |

A run's `status` in the snapshot can be any of `queued`, `ready`, `evaluating`,
`running`, `waiting`, `verifying`, `repairing`, `shipping`, `review`, `blocked`,
`complete`, `failed`, `escalated` or `canceled`. The selected-execution `run.state`
above uses the narrower queue vocabulary.

The envelope's `provenance` is `live` when the snapshot is no older than twice the
poll interval, `stale` when it is older (with a `reason` such as `snapshot is 132s
old`), and `unavailable` when there is no usable snapshot. Without a selector the
CLI judges only the snapshot's age, so a daemon that was just stopped still reads
`live` until the snapshot is that old. An unavailable status is never an empty
queue.

### Unavailable status

`kor status` can fail to read a snapshot or an execution. Both forms then exit `1`
and, with `--json`, print an envelope whose `provenance` is `unavailable`, with a
`reason` and an `error` object. The shape differs by form: the unselected form
carries `snapshot: null`, the selected form carries `run: null`.

| Form | `error.code` | When |
| --- | --- | --- |
| `kor status` | `snapshot_unavailable` | The daemon has not published a snapshot yet. |
| `kor status` | `snapshot_unreadable` | The snapshot file exists but cannot be read or does not match the schema. |
| `kor status` | `snapshot_invalid` | The snapshot's timestamp is invalid (for example in the future). |
| `kor status ID` | `execution_database_unavailable` | There is no execution database yet (nothing was ever queued). |
| `kor status ID` | `execution_not_found` | The database has no execution matching the selector. |

```text
$ kor status --json
{
  "schemaVersion": 1,
  "provenance": "unavailable",
  "observedAt": "2026-10-14T18:42:46.856Z",
  "snapshot": null,
  "reason": "daemon has not published a snapshot",
  "error": {
    "code": "snapshot_unavailable",
    "message": "daemon has not published a snapshot",
    "hint": "start `kor serve` or check the daemon state directory"
  }
}
$ kor status nope --json
{
  "schemaVersion": 1,
  "provenance": "unavailable",
  "observedAt": "2026-10-14T18:42:47.091Z",
  "run": null,
  "reason": "no execution database",
  "error": {
    "code": "execution_database_unavailable",
    "message": "no execution database",
    "hint": "run `kor run ISSUE-ID` before requesting execution status"
  }
}
```

Without `--json` the same failures are the usual one-line `FAIL status: <reason>.
Hint: <hint>` on stderr.

## Cancel and retry

```text
$ kor cancel LEE-1111
{
  "schemaVersion": 1,
  "issueId": "LEE-1111",
  "canonicalIssueId": "d8028008-c8b4-47a3-8b64-c00770784e73",
  "executionId": "cd1e6aa4-be39-466f-8d69-eb4b8687dfaf",
  "command": "cancel",
  "accepted": true
}
```

`kor retry` returns the same shape with `"command": "retry"`. A queued or blocked
execution cancels immediately; a running one cancels once its session has
stopped, so poll until `run.state` is `canceled` rather than trusting
`accepted: true` alone. `cancel` accepts queued, running and blocked executions;
`retry` accepts failed, blocked and canceled ones. Anything else exits `1` with
the code `not_accepted`:

```text
$ kor cancel LEE-1111 --json
{"schemaVersion":1,"error":{"code":"not_accepted","message":"cancel was not accepted for execution cd1e6aa4-be39-466f-8d69-eb4b8687dfaf","hint":"cancel only queued, running, or blocked executions"}}
```

`cancel` and `retry` change only Kor's queue. They do not move the Linear issue.

## Errors

Every command reports a failure on one line on stderr, with a non-zero exit code
and a recovery hint. No stack trace is printed unless `--debug` is passed.

```text
FAIL <command>: <message>. Hint: <what to do next>
```

```text
$ kor frobnicate
FAIL frobnicate: unknown command "frobnicate". Hint: run `kor --help` to list available commands
$ kor run
FAIL run: invalid command arguments. Hint: use kor run ISSUE-ID [--dry-run] [--json]
$ kor run LEE-999999
FAIL run: Linear GraphQL request failed: errors=1; codes=INPUT_ERROR; upstream details redacted. Hint: check the issue identifier, the Linear credentials, and that config.yaml maps the issue's team or project to a repository, then retry
$ kor run LEE-1111 --dry-run
FAIL run: No Kor repository mapping for Linear team LEE. Hint: check the issue identifier, the Linear credentials, and that config.yaml maps the issue's team or project to a repository, then retry
```

With `--json`, the same failure is a versioned object on stdout, so a wrapper
never has to parse the human line:

```text
$ kor frobnicate --json
{"schemaVersion":1,"error":{"code":"unknown_command","message":"unknown command \"frobnicate\"","hint":"run `kor --help` to list available commands"}}
$ kor run LEE-999999 --json
{"schemaVersion":1,"error":{"code":"command_failed","message":"Linear GraphQL request failed: errors=1; codes=INPUT_ERROR; upstream details redacted","hint":"check the issue identifier, the Linear credentials, and that config.yaml maps the issue's team or project to a repository, then retry"}}
```

| Field | Meaning |
| --- | --- |
| `error.code` | A stable machine-readable code: `invalid_arguments` and `unknown_command` (exit `2`), `execution_not_found`, `not_accepted`, `invalid_port`, `install_failed`, `uninstall_failed`, or the catch-all `command_failed` (exit `1`). `kor status` adds its own unavailable codes, listed above. |
| `error.message` | One line. Credentials, issue text and upstream response bodies are never included. |
| `error.hint` | What to do next. |

`kor status` is the exception: when it cannot read a snapshot or an execution it
prints the `unavailable` envelope (which carries the same `error` object) instead
of the bare error object, for both the unselected and the selected form. A usage
error in `kor status` is the ordinary bare error object.

### `kor doctor --json` and `kor plan --json`

`doctor --json` prints the checks as one object and exits `1` when any check
failed. Each reachable repository also has a `repo <key> tools` check describing
the effective available tool set and its source (derived or overridden).
A failed check is not a command error, so there is no `error` object and
no stderr line:

```text
$ kor doctor --json
{"schemaVersion":1,"ok":false,"checks":[{"name":"Kor config","status":"ok","detail":"/tmp/kor-t15/home/.config/kor/config.yaml"},{"name":"Linear key","status":"ok","detail":"available"},{"name":"TypeSafe key","status":"ok","detail":"available"},{"name":"CLIProxyAPI with Kor key","status":"ok","detail":"reachable"},{"name":"CLIProxyAPI management access","status":"error","detail":"management key missing"},{"name":"quota-axi","status":"error","detail":"unavailable"},{"name":"Claude Code","status":"ok","detail":"2.1.300 (Claude Code)"},{"name":"no-mistakes daemon","status":"error","detail":"not running"},{"name":"repo demo-app","status":"ok","detail":"/tmp/kor-t15/demo-app (main)"}]}
```

`plan --json` prints the preflight and exits `1` when `ready` is `false` (readiness
is blocked, a decision is escalated, or the route is a fallback):

```text
$ kor plan LEE-1117 --json
{"schemaVersion":1,"planId":"plan-ab730c39-9a69-4f34-8a08-3f8d64aee7bb","ready":true,"route":{"provider":"anthropic","model":"claude-haiku-5-5","accountPolicy":"fill-first","sessionAffinity":true,"reasoningLevel":"medium","label":"jev","decisionId":"route-plan-ab730c39-9a69-4f34-8a08-3f8d64aee7bb"},"fallback":false,"decisions":[{"kind":"readiness","choice":"ready","confidence":0.94,"applied":true,"escalated":false},{"kind":"complexity","choice":"small bounded change","confidence":0.39,"applied":true,"escalated":false},{"kind":"risk","choice":"low operational risk","confidence":1,"applied":true,"escalated":false},{"kind":"route","choice":"claude-haiku-5-5","confidence":0.96,"applied":true,"escalated":false},{"kind":"skill","choice":"generalist","confidence":1,"applied":true,"escalated":false},{"kind":"agent","choice":"generalist","confidence":1,"applied":true,"escalated":false}],"commentWritten":false}
```

`outage` (a string) is present when Jev was unavailable, and `commentWritten` says
whether a clarification comment was posted to the issue.

Each decision in `plan --json` also includes `policyChecks` and `reasons`.
Checks have `name`, `result` (`pass`, `fail` or `unresolved`) and an optional
actionable `reason`. A UI-labelled ticket without an image has a failed
`ui-screenshot` check and a `blocked` readiness decision. These fields are retained
in the durable Jev audit.

### `kor linear lint --json`

Use `kor linear lint ISSUE-ID --json`, or `kor linear lint --project PROJECT-ID
--json` for a project of up to 100 issues. This read-only command needs Linear
credentials, with no daemon, Kor repository configuration or TypeSafe key required.
It returns `{ "schemaVersion": 1, "ready": boolean, "issues": [...] }`. Each issue
has `issueId`, `status` (`ready` or `blocked`), `hasScreenshot`, and `checks` in the
same shape as plan policy checks. `ready` means every ticket check passes; it does
not include the verified-route check or Jev's scope judgment. An empty project
returns `ready: true` and `issues: []`.

Exit `0` means ready; exit `1` means blocked or an operational failure; invalid
arguments exit `2`. A blocked report is a normal result without an `error` object.
Operational and usage failures use the standard JSON error envelope. Project
queries fail explicitly if there are more than 100 issues, rather than reporting
readiness from an incomplete page.

## Over HTTP

`kor serve` listens on `127.0.0.1:8327` by default (`--port` changes it; port
`8317` is refused because CLIProxyAPI uses it). `GET /status` returns the same
envelope as `kor status --json`. The cockpit sends overrides with
`POST /overrides` and reverts them with `POST /overrides/<id>/revert`; both
accept local JSON requests only. See [configuration](configuration.md).

## Calibration context report

`kor calibrate report [--since ISO-8601] [--context] [--json]` reads the local calibration database. `--context` adds per-arm context medians to text output. JSON output includes arm context estimates with observation counts. See [Measure session context](context-bench.md) for definitions and the live bench.
