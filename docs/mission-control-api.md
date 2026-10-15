# Mission Control daemon API

The browser protocol lives in `packages/mission-control/src/index.ts`, exported
as `@kor-code/mission-control`. Its imports are type-only; importing the package
in the browser does not execute the configuration, SQLite, or provider modules.
`MissionControlApi` maps every method and path to its request and response.
`MissionEvent` describes the live stream. All responses carry `schemaVersion: 1`.

## Open the app

Build the monorepo and the web package, then run `kor serve` and `kor ui`.
The daemon binds exclusively to `127.0.0.1`, normally on port 8327. It serves
`packages/web/dist`; `kor serve --ui-dir /absolute/path/to/dist` selects another
build. A missing build returns an explicit unavailable error. SPA navigation
falls back to `index.html`; missing assets and paths outside the build are refused.
The source checkout is resolved from the installed CLI, so launching the daemon
from another working directory does not change the session launcher or asset path.

`kor ui` discovers the daemon's actual port from Kor's private state and opens
the default browser (including the Windows browser under WSL). It supplies the
UI token in the URL fragment. It does not print the token. The app must consume
`#token=...` before loading data, clear the fragment with `history.replaceState`,
and keep the token in memory or tab-scoped session storage.

The daemon generates a 256-bit capability on first start, keeps its only server
copy in `$XDG_STATE_HOME/kor/ui-token` (default `~/.local/state/kor/ui-token`),
and enforces mode 0600 inside a mode-0700 state directory. It persists across
restarts. No token is embedded in HTML, returned by an API, accepted in a query
parameter, or supplied as a cookie.

## Authenticate every request

Send `Authorization: Bearer <token>` on every `/api` request, including reads
and SSE. JSON writes also require `Content-Type: application/json` and have a
64-KiB body limit. Origin must be the daemon's own loopback address and port;
foreign origins and cross-site requests are refused, and no CORS permission is
issued. The Host header must name the loopback address or localhost and the
listening port. These checks apply before any action is dispatched.

Errors use the shared `ApiError` shape. HTTP 401 means no valid UI token; 403
means forbidden origin/host; 400 means invalid input; 404 means unknown resource;
409 means the run or daemon cannot currently accept the action; 503 means a
required service is unavailable. Read panels return labelled values: an upstream
failure cannot look like a successful empty result. Model compatibility probes
can successfully return `verified: false` when a required capability is absent.

The CLI/status-line routes `/status` and origin-free `/overrides` remain
available for existing local tools. Browser POSTs to the legacy override route
remain forbidden. The browser always uses the authenticated `/api` routes.

## Screen data

| Read | Content |
| --- | --- |
| `/api/status` | The CLI's existing daemon snapshot, including runs, accounts, decision audit and override audit |
| `/api/projects` | Configured repository mappings with their durable runs |
| `/api/runs`, `/api/runs/:id` | Run status, current stage, needs-input reason and account provenance |
| `/api/runs/:id/terminal` | A bounded terminal tail plus the full byte offset for stream continuation |
| `/api/runs/:id/session` | The next session's skills plan with overrides applied, the playbook, the tools, and each possible edit's per-turn token change or refusal reason; 409 until the run's repository is known |
| `/api/linear/issues?project=<repository-key>` | Up to 100 issues per mapped team, filtered by the mapped Linear project |
| `/api/github/pulls?repo=<repository-key>` | Up to 100 pull requests from the actual GitHub repository |
| `/api/models` | Gateway catalogue joined to Kor's compatibility registry |
| `/api/pool`, `/api/quota` | Gateway account health and measured quota, with provenance |
| `/api/brain` | Persisted Jev decisions, the same calibration report as `kor calibrate report`, and `learnings`: the skill outcome-learning changes and per-skill statistics from `kor skills report` |
| `/api/config`, `/api/connections` | Validated settings and provider connection status; never credentials |

The daemon exposes candidate probability distributions from the decision audit.
Missing account binding and learned-memory data are explicitly unavailable:
the gateway's preferred account is not proof that an upstream session used it,
and there is no learned-memory store in the current foundation.

## Actions

| Write | Behaviour |
| --- | --- |
| `POST /api/runs` | Resolve and validate all Linear issues before adding any durable assignments; returns 202 |
| `POST /api/runs/:id/cancel` | Request cancellation through the durable queue and abort the owned active session |
| `POST /api/runs/:id/retry` | Retry failed, canceled or blocked execution; blocked publication resumes its existing stage |
| `POST /api/runs/:id/answer` | Persist the answer and Linear comment, then retry a needs-input run |
| `POST /api/runs/:id/note` | Persist guidance and an issue comment; guidance is supplied to the next session attempt |
| `POST /api/runs/:id/approve` | Release a verified execution waiting at the publication gate |
| `POST /api/runs/:id/request-changes` | Persist feedback, discard approval and verification, and rerun the same issue branch |
| `POST /api/overrides`, `POST /api/overrides/:id/revert` | Override policy, durable audit and Linear comments. `target` is `route`, `skills`, `playbook`, `tools` or a decision ID; `overBudget: true` accepts a skill plan above the repository budget. A refused override is a 409 carrying its audited record; skill and playbook edits also return `tokens: { before, after }` |
| `POST /api/ask` | Jev selects a grounded recommendation over the real snapshot; the user invokes its typed action separately |
| `PUT /api/config`, `PUT /api/projects/:project` | Parse the config schema, write an atomic private backup and replacement, then reload the idle controller |
| `POST /api/models/:id/probe` | Run the CLI's isolated compatibility probe and persist the result in the same model registry |
| `POST /api/accounts/:id/pause`, `.../resume` | Resolve the opaque account slot inside the gateway adapter and update its actual management status |
| `POST /api/connections` | Persist write-only provider credentials in private Kor state and update the relevant adapter |

Repository setting `ship: approve` keeps a verified execution in `waiting`
until approval. `ship: auto` preserves existing publication behaviour and is
the default for existing configurations. Approval releases publication; it does
not merge a pull request. GitHub observations still govern review and completion.
Request changes during an active publication operation is refused; it cannot
silently discard a running pipeline. Configuration changes are refused while
work or polling is active and apply without a daemon restart when accepted.

Run actions return HTTP 200 with `accepted: true` once the durable change is
applied, even if Linear synchronization fails. `linearSync.status` is `synced`
when the outbox is empty, or `pending` with the daemon-wide `pendingWrites`
count. Pending writes remain durable and the daemon retries them on its next
Linear poll. Show the action as applied with synchronization pending; do not
repeat the action to retry synchronization. Sync failures remain in daemon
diagnostics. A 409 still means the action was refused.

An answer cannot bypass incomplete dependencies or readiness policy. If an
issue has no acceptance criteria, the explicitly supplied answer becomes the
criterion for that attempt. Guidance is durable across daemon restarts. Notes
do not inject text into an already-running Claude session.

Jev's current API returns typed choices and probabilities, not free-form chat.
Ask Jev reports its selected recommendation and confidence and never executes
a suggested action on its own.

## Live events

Use authenticated `fetch('/api/events')` and consume its `ReadableStream`.
Native `EventSource` cannot send the authorization header. Each SSE `message`
contains the JSON `MissionEvent`, with the same `id` in the SSE `id` field.

The first connection gets a fresh snapshot. Reconnect with `Last-Event-ID` to
replay retained events. A daemon restart or expired replay history emits `reset`
and a fresh snapshot. Keep-alive comments arrive every 15 seconds. History is
bounded to 512 events and 2 MB; there are at most 32 clients, and slow clients
are disconnected once their write queue exceeds 1 MB.

Events cover runs, all seven stages, actual stdout/stderr lines, daemon activity,
Jev decisions, needs-input, account pool, quota, Ask Jev responses and config
changes. Terminal writes are serialized and redact loaded credentials before
persistence and publication. The read endpoint returns at most the last 1 MiB.
Build the React subscription outside components and read it through
`useSyncExternalStore`; do not add effects.

## Installation and state compatibility

Agent homes and model probes remain disposable. The daemon launches execution
sessions under Kor's session directory and passes gateway credentials directly
to the isolated launcher; configuring a gateway in the UI also configures
subsequent sessions. The CLI's `kor run` reads the same connected Linear account.

The queue migration adds `waiting` and durable operator messages at SQLite
schema version 7. Older Kor binaries reject this version; restore a pre-upgrade
database backup when downgrading. No running shared daemon or provider service
needs to be restarted to install this code.

## Durable times and spend

`MissionRun.createdAt` is the original enqueue time. `updatedAt` changes on
operator messages, measurements and meaningful assignment transitions, never on
snapshot reads or heartbeats. `startedAt` is the latest execution claim time;
queueing another attempt clears it. `completedAt` records complete, failed or
canceled transitions and is cleared on retry. All four are ISO-8601 strings or
null for history that predates timing persistence. Migration never invents
creation or completion times from a heartbeat or retry delay.

Verification attempts expose `startedAt` and `completedAt`; `verifiedAt` is the
latest successful verification's completion time, independent of publication.
Older untimed verification reports normalize both values to null.

`spend.value` contains individual session measurements with `recordedAt`, model,
cost and token counts. Measurements are persisted when a session returns, before
verification, including when calibration sampling is disabled. Retry history is
retained and calibration records are included without double-counting matching
attempt IDs. Filter `recordedAt` by the viewer's day to compute spend today;
unknown cost is null and must not be treated as zero. Runs whose previous
measurements were never recorded label their spend history unavailable. A
measurement's optional `skillPack` is the guidance that session received after
overrides and policy: delivered skills with tier, tokens and source, the playbook,
and per-turn token totals. It is absent for sessions without skills and for older
measurements.

Terminal events and the terminal tail share one byte offset per run, including
daemon log lines; a client appends only events past the tail's `offset`.

Every SSE envelope already carries `observedAt`, the event publication time.
For historical decision/override activity, use each record's `recordedAt`;
replaying an event must retain its original time. Snapshot freshness is separate
from execution, verification and billing timestamps.
