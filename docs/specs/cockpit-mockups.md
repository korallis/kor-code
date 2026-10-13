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

Status: **Validated** on fixture data in the sandboxed Claude Code 2.1.296 (`pnpm cockpit:proof`, and the interactive TUI driven through `pnpm cockpit`). No value is live except what the Claude Code session reports about itself; Linear, Jev, the gateway and the controller reach the cockpit when Phases 1-5 land. Sandbox runs are offline: the cockpit needs no model, so the child's model endpoint is a local stub and CLIProxyAPI is never contacted (`--live-model` opts in). `pnpm isolation:proof` traces a headless view, or with `--interactive` the TUI, to show the session never touches the real Claude, Codex or agents homes or port 8317. ADR 0006 records why the cockpit is a Claude Code mod.

`packages/claude-plugin` is one hooks module (`hooks/register.tsx`). It draws three things and writes nothing outside the session:

| Surface | What it shows |
| --- | --- |
| Status line | `[FIXTURE] Kor FIX-123 · <stage> n/7 · <status> · <route> · <agents working> · <overrides> · [LIVE] CC <version>`, updated on every replay step and override |
| `/kor [view] [id]` | Opens the cockpit pane on a view, focused; under `claude -p` it prints the same view as text |
| `/kor-status` | The sandbox's load proof, answered by the plugin's own hook rather than the model |

Views, with their pane hotkeys: `1` cockpit (the main mockup), `2` issue (intent, acceptance and evidence, next action), `3` project, `4` decisions (the decision stream), `5` agents, `6` accounts (slots, failover, the unavailable live catalogue), `7` context (manifest sources and what was dropped), `8` Linear links (records and writes), `9` overrides. Drill-downs: a decision row opens the decision view (question, choice, confidence, candidates, reasons, evidence, policy checks) with `a` apply, `o` override, `e` gather evidence, `r` re-evaluate and `b` back; an agent row opens that agent's events. `p` replays the fixture execution one event every 1.5 s through all seven lifecycle stages; `q` closes the pane.

Labels: every row leads with its provenance (`[FIXTURE]`, `[LIVE]`, `[STALE]`, `[UNAVAILABLE]`), so truncation never hides it, and the pane title carries `FIXTURE DATA`. Overrides are session-local records, shown with the choice Jev made, revertible from the pane (`Revert ovr_n`) or with `/kor revert ovr_n`, and never sent to Jev, the gateway or Linear.

Commands for headless use: `/kor replay` prints every replay frame's status line and the final cockpit; `/kor override <decision> [choice]`, `/kor apply|evidence|reevaluate <decision>` and `/kor revert <override>` record and revert actions.
