# Jev Code cockpit mockups

Every value and state below is illustrative.

## Main cockpit

~~~text
┌──────────────────────────────────────────────────────────────────────────────┐
│ JEV CODE                                      ● LINEAR CONNECTED   AUTO ACTIVE │
├───────────────────────────────┬──────────────────────────────────────────────┤
│ CURRENT ISSUE                 │ DECISION STREAM                              │
│ Matilda v2 · LIN-123          │ 10:42  Task classified                       │
│ Investigate performance      │        performance investigation              │
│ regression                    │ 10:43  Sonnet / medium selected              │
│                               │        cache retained                         │
│ IN PROGRESS                   │ 10:44  Repository rules selected             │
│ Jev · orchestrating           │ 10:44  Existing implementation found          │
│ Investigator · working        │ 10:45  Frontend agent started                │
│ Reviewer · waiting            │ 10:47  Tests running                          │
├───────────────────────────────┼──────────────────────────────────────────────┤
│ SUBSCRIPTION POOL             │ ENGINEERING QUALITY                           │
│ Claude       5 / 5 available  │ Code reuse       preferred                    │
│ ChatGPT      4 / 4 available  │ Scope            focused                      │
│ Grok         1 / 1 available  │ Tests            running                      │
│ Devin        1 / 1 available  │ Risk             review ready                 │
├───────────────────────────────┴──────────────────────────────────────────────┤
│ [1] Linear  [2] Agents  [3] Context  [4] Accounts  [5] Decisions  [q] Quit    │
└──────────────────────────────────────────────────────────────────────────────┘
~~~

## Decision drill-down

~~~text
┌─ JEV DECISION dec_01JEV... ────────────────────────────────────────────────────┐
│ Question   Which route fits this performance investigation?                    │
│ Choice     Claude Sonnet · medium effort                                      │
│ Confidence 0.86                                                               │
│                                                                              │
│ Reasons                                                                       │
│  • Repository context is large and the cache is warm.                        │
│  • The task needs code changes and test execution.                            │
│  • The evidence does not justify a stronger route.                            │
│                                                                              │
│ [a] Apply  [o] Override  [e] Gather evidence  [r] Re-evaluate                 │
└───────────────────────────────────────────────────────────────────────────────┘
~~~

## Account view

~~~text
┌─ PROVIDER ACCOUNTS ────────────────────────────────────────────────────────────┐
│ Provider  Slot       State       Route        Last event                        │
│ Claude    claude-01  available   preferred    session affinity retained         │
│ Claude    claude-02  available   standby      waiting                           │
│ ChatGPT   gpt-01     available   eligible     no active session                 │
│ Grok      grok-01    available   eligible     no active session                 │
│ Devin     devin-01   unknown     blocked      compatibility test required      │
├───────────────────────────────────────────────────────────────────────────────┤
│ Failover: LIN-123 · claude-01 → claude-02 · reason: quota response              │
│ Replay: not attempted because the stream had started                             │
└───────────────────────────────────────────────────────────────────────────────┘
~~~

## UI rules

- Show live, stale, illustrative, and unavailable states with distinct labels.
- Keep the main transcript uncluttered.
- Make the reason for each Jev decision one keypress away.
- Keep manual overrides visible and reversible.
- Never show secrets or raw provider tokens.
- Start from one tested visual layer. Do not stack overlapping Mods without testing.

## Implementation (Phase 6)

Status: **Validated** on a live daemon run in the sandboxed Claude Code 2.1.299: during a real execution of a LEE issue, `/kor` drew the issue, route, account pool and Jev's route decision `[LIVE]`; a `/kor override route <model>` was applied by the daemon, audited and commented on the issue; stopping the daemon turned every daemon value `[STALE]` with its age, and with no snapshot `[UNAVAILABLE]`. `pnpm cockpit:proof` replays the fixture execution behind `/kor demo` through all seven stages and every view, and checks that the live cockpit with no daemon draws `[UNAVAILABLE]`, never fixture data. ADR 0006 records why the cockpit is a Claude Code mod.

`packages/claude-plugin` is one hooks module (`hooks/register.tsx`). It reads the daemon and draws; it writes nothing itself:

| Surface | What it shows |
| --- | --- |
| Status line | `[LIVE] Kor LEE-57 · <stage> n/7 · <status> · <route> (<source>) · <overrides> · [LIVE] CC <version>`, re-read every 5 s; `[STALE 2m] …` or `[UNAVAILABLE] Kor · daemon down` when the daemon stops |
| `/kor [view] [id]` | Opens the cockpit pane on a view of the daemon's status; under `claude -p` it prints the same view as text |
| `/kor override <decision\|route> <choice>`, `/kor revert <override>` | Sent to the daemon, which decides; the cockpit prints its answer |
| `/kor demo [view\|replay\|…]` | The fixture execution, labelled `[FIXTURE]`, with session-local actions |
| `/kor-status` | The sandbox's load proof and the status line, answered by the plugin's own hook rather than the model |

Data (`hooks/live.ts`): `GET http://127.0.0.1:8327/status` first (`KOR_STATUS_URL`), then `snapshots/index.json` under the Kor state directory (`KOR_STATE_DIR`, else `XDG_STATE_HOME/kor` or `~/.local/state/kor`). A status read that gets no answer within 2 s counts as the daemon not answering (Claude Code's fetch otherwise waits about 30 s on a closed loopback port). Each part of the view (execution, issue, decisions, accounts, acceptance, overrides) carries its own label; the account pool also honours the daemon's own label for it, so a failed gateway read is stale or unavailable, never a fresh empty pool:

- `[LIVE]`: the daemon answered over HTTP and the part's `observedAt` is within the daemon's `pollIntervalSeconds`.
- `[STALE]`: older than that, or read from the snapshot because the daemon did not answer; the section title carries the age.
- `[UNAVAILABLE]`: the daemon does not report the part (acceptance findings until verification reports them, failovers), or there is neither a daemon nor a snapshot.

Jev chose these rules (TypeSafe Choice, `jev-1.13.0`): HTTP and age for LIVE (0.73 over age alone), re-reading every 5 s (0.73), refusing an override when the daemon does not answer rather than queueing it (1.00), and requiring the override's choice to be named (0.88).

Views, with their pane hotkeys: `1` cockpit (the main mockup), `2` issue, `3` project (the daemon's executions), `4` decisions, `5` agents, `6` accounts (the gateway's account slots by provider; identities are opaque hashes), `7` context, `8` Linear links, `9` overrides. A decision row opens its drill-down (question, choice, confidence, candidates, reasons, evidence, policy checks); live, it offers one `Override → <candidate>` button per other candidate. `f` re-reads the daemon, `m` switches between live and demo, `q` closes the pane; in the demo `p` replays the fixture one event every 1.5 s.

Overrides (`packages/daemon`): `POST /overrides` with `{ executionId, target, choice }` (`target` is `route` or a decision ID), from local tools only (JSON bodies, no browser `Origin`). The daemon checks policy (the execution is not finished; a route names a model `kor models probe` verified and differs from the route in force; a decision choice is one of its candidates), records the override in `override_audit` in `kor.db` whatever the outcome, logs it to `kor logs <execution>`, and comments on the Linear issue when it applies (a stable comment ID, retried on the next poll if Linear fails). An applied route override takes effect from the execution's next attempt. `POST /overrides/<id>/revert` reverts one and comments again.
