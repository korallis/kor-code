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

- Use the installed `kor` (or `bin/kor` from the checkout). Both print clean
  JSON on stdout. `pnpm kor` prints pnpm build output before the command's own
  output and is meant for interactive use.
- The daemon and the CLI must share one `HOME` or the same `XDG_CONFIG_HOME`,
  `XDG_STATE_HOME` and `XDG_DATA_HOME`. They exchange state through
  `kor.db` and `snapshots/` under the state directory.
- Do not start `kor serve` from a script on every poll. The daemon is a
  long-running process (`systemctl --user enable --now kor`, or a terminal).
- Exit codes: `0` success, `1` the command ran and failed, `2` the arguments were
  wrong (a usage error).

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
| `run.state` | `queued`, `running`, `shipping`, `review`, `complete`, `failed`, `blocked` or `canceled`. Treat an unknown future state as "not finished". |
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
the exit code is `1`:

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

With no selector, `kor status` prints the daemon's snapshot envelope. It is the
same document served at `http://127.0.0.1:8327/status` and written to
`snapshots/index.json` in the state directory.

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
| `accounts`, `decisions` | Each is `{ value, provenance, observedAt }`, plus `reason` when it could not be read. `provenance` is `live`, `stale` or `unavailable`. |
| `overrides` | The audit of cockpit overrides. |

The top-level `provenance` has the same meaning as above. Without a selector the
CLI compares the snapshot's age against twice the poll interval, so a daemon that
was just stopped still reads `live` until the snapshot is that old. A missing
snapshot is `unavailable`; an unavailable status is never an empty queue.

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
| `error.code` | A stable machine-readable code: `invalid_arguments` and `unknown_command` (exit `2`), `execution_not_found`, `not_accepted`, `invalid_port`, `install_failed`, `uninstall_failed`, or the catch-all `command_failed` (exit `1`). |
| `error.message` | One line. Credentials, issue text and upstream response bodies are never included. |
| `error.hint` | What to do next. |

`kor status` with a selector that matches nothing is the one exception: it
returns the `unavailable` status envelope above (which carries the same `error`
object) instead of the bare error object.

## Over HTTP

`kor serve` listens on `127.0.0.1:8327` by default (`--port` changes it; port
`8317` is refused because CLIProxyAPI uses it). `GET /status` returns the same
envelope as `kor status --json`. The cockpit sends overrides with
`POST /overrides` and reverts them with `POST /overrides/<id>/revert`; both
accept local JSON requests only. See [configuration](configuration.md).
