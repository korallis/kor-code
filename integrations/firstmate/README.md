# Dispatch Kor from a Firstmate home

This adapter lets a Firstmate home dispatch a Linear issue to Kor, poll its execution, and cancel it. Firstmate keeps the fleet view and captain decisions; Kor owns the durable queue and execution. The adapter emits JSON and changes no Firstmate configuration. Wiring the private home is a separate installation step.

## Install

Requirements: Linux, Node 24+, pnpm, Bash, and `jq`. In this checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
bin/kor doctor
bin/kor serve
```

Configure the repository mapping and credentials as described in [configuration](../../docs/configuration.md). The daemon and the adapter must use the same `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_DATA_HOME`. `bin/kor` emits clean JSON for machine commands; `pnpm kor` includes pnpm build output and is intended for interactive use.

The adapter defaults to this checkout's `bin/kor`. Set `KOR_BIN=/absolute/path/to/kor` to use a different executable. It is a single executable path, not a shell command with arguments. Do not rebuild or launch a daemon on every poll.

## Wire the private home

Register a dispatch type named `kor` in the home's dispatch configuration. Use the absolute adapter path and pass arguments as separate values:

| Firstmate action | Command | Home action |
| --- | --- | --- |
| “run LEE-n on Kor” | `kor-dispatch dispatch LEE-n` | Save `executionId` on the fleet entry. Repeated dispatch returns the same assignment. |
| Supervise | `kor-dispatch poll EXECUTION-ID` | Poll every 5–15 seconds. Render `state`, `provenance`, `pullRequestUrl`, and `costUsd`. |
| Captain input | Poll returns `fleetState: "needs-decision"` | Open a captain decision with `captainCall.reason`; deduplicate by `captainCall.key`. |
| Cancel | `kor-dispatch cancel EXECUTION-ID` | Wait until a live poll reports `canceled`. `accepted: true` alone is a request acknowledgement. |

The home should resolve its matching captain decision after a live poll clears `captainCall`, or after the captain answers and authorizes a retry. Update the Linear issue with the answer and use `kor retry EXECUTION-ID`; retries keep the execution ID and increment `attempts` when claimed, giving a new decision key if blocked again. The adapter never answers or retries automatically.

Capacity starts at one Kor execution per repository and two total in Kor config. Reserve one of the home's kor-code worker slots for each distinct Kor execution while `holdsCapacity` is true, including needs-input and stale states. Compute available ordinary-worker slots as `max(0, configuredSlots - reservedKorExecutions)`. Deduplicate reservations by execution ID. Release only on a live `complete`, `failed`, or `canceled` poll; a failed command or stale observation keeps the prior reservation. The adapter provides the signal; the home applies its capacity change.

`fleetState` is `working`, `needs-decision`, `done`, `failed`, `canceled`, or `paused`. `done` means Kor reported `complete`; it does not independently prove a merge. Stale observations map to `paused` and emit no captain call. Nonzero exit means the command or response failed: retain the last fleet entry, show the diagnostic, and retry supervision. Do not infer completion from unavailable status.

## CLI contract, version 1

`kor run ISSUE-ID --json` returns `schemaVersion`, `issueId` (Linear key), `canonicalIssueId` (Linear UUID), `executionId`, `status`, and `queued`. It resolves the issue through Linear and validates the repository mapping before enqueueing. Repeated dispatch is idempotent, including blocked and completed assignments; `queued` describes the current state, not a new-run guarantee. `--dry-run` does not create an execution and has no execution ID.

`kor status --json EXECUTION-ID|ISSUE-ID` returns this separate selected-execution envelope. Without a selector, the existing cockpit snapshot envelope is unchanged. Selectors accept an execution UUID, canonical Linear UUID, or a stored issue key; they do not contact Linear. Newly queued issue keys are stored before the daemon claims them. Older queued assignments acquire their key on the next claim.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1`. Consumers must reject unsupported versions and ignore additive fields. |
| `provenance` | `live` if the owning daemon's Linux process identity matches and its snapshot is fresh; otherwise `stale`. |
| `observedAt` | UTC time the CLI read the durable assignment. |
| `run.executionId`, `run.issueId`, `run.issueKey` | Durable execution ID, canonical issue UUID, nullable issue key. |
| `run.state` | Current queue state: `queued`, `running`, `blocked`, `complete`, `failed`, `canceled`. Future lifecycle states must not be treated as completion. |
| `run.attempts`, `run.cancelRequested` | Claim count and whether an active cancellation is pending. |
| `run.needsInput` | `{ "reason": "…" }` for blocked executions, otherwise `null`. Missing acceptance criteria block before a model is launched; failed verification also blocks. |
| `run.pullRequestUrl` | Reported PR URL, or `null` if shipping has not published one. |
| `run.costUsd` | Reported execution cost, or `null` when telemetry has not published it. `null` is never zero spend. |
| `reason` | Diagnostic when stale or unavailable. |

The existing daemon does not yet publish PR or aggregate cost data; those fields are deliberately null until the shipping and telemetry producers populate the snapshot. This adapter does not estimate either value.

An unknown selector or missing database returns `provenance: "unavailable"`, `run: null`, a `reason`, and exit 1. Stale known executions still return exit 0 so the supervisor can display the durable record. Consumers must inspect provenance. `kor cancel EXECUTION-ID|ISSUE-ID --json` returns `executionId`, both issue identifiers, `command: "cancel"`, and `accepted`. A queued or blocked execution cancels immediately; a running execution cancels after its session stops. Exit 1 means not accepted; usage errors use exit 2.

## Validation

The T11 local proof uses a real `bin/kor serve` process with isolated XDG directories and a live read of the existing throwaway issue LEE-1107. Its missing acceptance criteria produce a needs-input state before any session starts. Dispatch, identifier lookup, repeat-dispatch deduplication, captain-call deduplication, blocked cancellation, unknown status, and stale-after-stop behavior are **Validated**. No model session or Firstmate private-home installation is claimed by this proof. Firstmate fleet rendering and actual captain delivery remain **Proposed** until the home is wired.

Example commands and observed output are in the root [README](../../README.md#dispatch-from-firstmate). The adapter emits a captain-call payload; the private home is responsible for delivering it.
