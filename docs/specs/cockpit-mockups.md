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
