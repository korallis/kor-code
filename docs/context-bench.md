# Measure session context

Run the recorded-stream proof without gateway credentials:

```bash
pnpm context:proof
```

The proof sends a sanitized three-turn live recording through `SessionLauncher`, checks its token counts, migrates an old SQLite table, reopens the database, and invokes the real report CLI. It also checks split assistant messages, child-session exclusion, and successful and failed skill calls.

To measure live sessions, obtain one route per issue from Jev and save the routes in a JSON object keyed by the case IDs below. Each value uses Kor's `Route` shape and must include `label: "jev"` and its `decisionId`. The benchmark passes those decisions to the launcher unchanged. It does not select a model, provider, or effort.

Run the fixed issue set at a pinned commit:

```bash
pnpm context:bench --revision COMMIT --routes /tmp/jev-routes.json --output /tmp/kor-context --launch-profile lean
```

The default is three repetitions per case. Use `--case contributor-note --repeats 1` for a smoke run. Credentials come from Kor's runtime gateway environment. The benchmark uses the existing gateway and creates a temporary loopback capture proxy.

| Case ID | Change |
| --- | --- |
| `contributor-note` | Add a short guide to build and typecheck commands. |
| `docs-index` | Link the top-level documentation files. |
| `event-refactor` | Reformat stream line parsing without changing behavior. |
| `keyboard-focus` | Add button keyboard focus styling. |
| `finite-compact` | Handle nonfinite compact counts as unavailable. |

Each repetition uses a fresh local clone at the specified commit, the selected launch profile (`lean` by default), and the same allowed tools. Artifacts live outside the checkout in a unique run directory. Keep the revision, route decisions, CLI version, and case set constant when comparing later changes. Cache warmth depends on the upstream provider and is measured rather than assumed.

To compare settings alone, run the same command twice with
`--launch-profile standard` and `--launch-profile lean`, keeping the tools and
route file constant. `standard` uses the current base launcher settings with
the same tool list; both profiles suppress Claude Code’s bundled skills for
per-execution skill delivery. Both profiles keep the cockpit plugin. The benchmark fixes the same
tool list for both profiles to isolate settings; production controller sessions independently
apply Jev’s capability selection within repository policy. Each summary includes
`startContextTokens` and `cacheReadShare`, calculated across the session as
`cache_read / (cache_read + cache_creation)` (null when both are zero).
For back-to-back executions, compare the second repetition of each profile and
also inspect `turns[0]` to isolate reuse of the starting prefix. These are fresh
sessions with separate homes, not resumed conversations.

The run directory contains request bodies, a stream recording, summaries, `metrics.sqlite`, and a report. The standalone bench records the selected profile in each summary and uses the baseline arm without sampled pairs. Files have private permissions. Only validated `X-CPA-TRACE-ID` response headers are retained in gateway telemetry. Credential headers are never recorded. Request bodies and streams can contain repository content, so review artifacts before sharing them. `count_tokens` is called for each captured messages request with its original model, system, tools, messages, and Anthropic feature headers. Its count can differ from billed usage. HTTP failures and timeouts are recorded as unavailable counts.

The printed `verified` value means that the session completed and the listed file and diff checks passed. These small benchmark checks run the changed parser and formatter, but do not replace Kor's shipping verification or prove that a refactor preserves all behavior. No benchmark session commits or publishes its changes.

## Read calibration context medians

```bash
kor calibrate report --context
kor calibrate report --context --since 2026-10-01T00:00:00Z --json
```

The text report adds per-arm medians with the number of observations. The JSON report includes each arm's `context` object. Runs with status `verified` or `failed` contribute. Interrupted runs remain stored but are excluded from these medians.

| Metric | Definition |
| --- | --- |
| `startContextTokens` | First assistant message's input, cache creation, and cache read tokens in the first attempt. |
| `contextTokenSum` | Sum of those context counts across unique main-session assistant message IDs and all attempts. |
| `cacheReadTokens`, `cacheCreationTokens` | Sum of the per-turn counts across all attempts. |
| `turns` | Number of unique main-session assistant message IDs across all attempts. |
| `toolLoads`, `skillLoads` | Calls with a successful tool result across all attempts. |

Assistant blocks with the same message ID update one turn. Child-session events with `parent_tool_use_id` are excluded. Each turn stores input, output, cache read, cache creation, and context tokens. Output tokens use the greatest reported value for that message. Omitted cache counters count as zero when input usage is present. A stream without assistant usage leaves start and sum unavailable.

Load events identify tool calls, `Skill` calls, and `Read` calls for `skills/<name>/SKILL.md`. Their status is `requested`, `succeeded`, or `failed`. An advertised skill is not a load. Shell commands that read a skill are not inferred as loads. Tool arguments and skill bodies are excluded from these events.

The existing final-result usage and cost fields retain their meaning. New `run_metrics` columns are `start_context_tokens`, `context_token_sum`, `turns_json`, and `load_events_json`. Migration is additive. Older payloads remain readable with unavailable context metrics. Fewer than 20 completed Jev/baseline pairs are labelled directional.

## Initial measured baseline

The first five-case smoke run used revision `9eec77a45edbbb20ca9221d50bbfade0c6d6c68f`, Claude Code 2.1.300, the legacy launcher, and one repetition per case. Jev selected `claude-sonnet-5` for all five runtime routes, with no effort override. Each case completed and passed its listed checks. This sample is directional. It contains no paired profile comparison.

| Case | Start context | Context sum | Cache reads | Turns | Cost USD | First count_tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| contributor-note | 41,350 | 126,401 | 83,642 | 3 | 0.1288 | 41,656 |
| docs-index | 41,334 | 273,048 | 252,177 | 6 | 0.1299 | 41,640 |
| event-refactor | 41,354 | 125,666 | 111,936 | 3 | 0.0640 | 41,660 |
| finite-compact | 41,380 | 125,830 | 112,145 | 3 | 0.0618 | 41,686 |
| keyboard-focus | 41,359 | 286,249 | 259,850 | 6 | 0.1369 | 41,665 |

The median start context was 41,354 tokens. The earlier research measured roughly 27k with different route and prompt conditions. This run did not reproduce that absolute count. The recorded-stream proof preserves the observed 41,350 / 42,296 / 42,755 per-turn context values and 0 / 41,348 / 42,294 cache reads. Use the same pinned environment for comparisons rather than treating 27k as a constant.

A later contributor-note smoke run measured 41,356 start tokens and a 126,488 context sum. It exited with code 1 because the generated note exceeded the fewer-than-20-lines criterion. The benchmark retained its telemetry and reported the failed check. The five-case table above records the earlier run.

## Settings profile comparison

Before per-execution skill delivery merged, six live Claude Code 2.1.300
sessions compared `standard` and `lean` on the same
logs argument-validation task at revision `f6dd971`, three fresh executions per
profile. Both profiles reused the task's recorded Jev route, the same six tools,
and the cockpit plugin. All six passed real CLI checks for invalid arguments
and valid text/JSON output, plus `git diff --check`.

| Measurement | Standard | Lean |
| --- | ---: | ---: |
| Median start context | 7,586 | 6,981 |
| Second execution first-turn cache read / creation | 6,160 / 1,425 | 0 / 6,979 |
| Second execution first-turn cache share | 81.21% | 0% |
| Third execution first-turn cache read / creation | 6,160 / 1,424 | 6,618 / 361 |
| Third execution first-turn cache share | 81.22% | 94.83% |
| Second execution whole-session cache share | 87.99% | 80.16% |
| Third execution whole-session cache share | 89.03% | 89.47% |

The settings saved 605 tokens (8.0%) against the current tool-limited launcher,
which already disables automatic memory. This did not reproduce the research
target of at least 1,300 further tokens saved. The second lean execution missed
the starting-prefix cache; the third reused more of it. These three executions
per profile are directional evidence, not proof of improved second-execution
cache reuse or lower total cost. Median context sum was 87,909 versus 97,761
and observed session cost was $0.00338 versus $0.00384 (standard versus lean).
Two standard sessions and all three lean sessions had one denied `git -C … diff`
command each; every session still completed and passed the runtime checks.

A follow-up investigation captured requests from four more executions per
profile, with the same input revision, task and Jev route. All eight passed the
real CLI checks. Consecutive requests had identical tools and system blocks in
both profiles. Lean also kept the prefix through the user prompt identical;
only the trailing environment message changed with the checkout path. Standard
included a changing Git snapshot before the user prompt.

| Follow-up execution | Standard first-turn read / creation | Lean first-turn read / creation |
| --- | ---: | ---: |
| 1 | 0 / 7,585 | 0 / 6,979 |
| 2 | 6,160 / 1,423 | 6,618 / 361 |
| 3 | 6,160 / 1,422 | 0 / 6,979 |
| 4 | 6,160 / 1,426 | 6,618 / 361 |

On the second execution, lean's first-turn cache share was 94.83% versus
standard's 81.23%; whole-session shares were 86.55% versus 85.97%. The later lean
miss occurred despite the stable prefix. These captures rule out changing
launcher prompt content as its explanation, but do not identify the upstream
cause or establish that the original miss was a one-off warm-up. Cache reuse
remains variable; the repeatable benefit here is the 605-token startup saving.

At that point, `standard` remained the default while gateway account affinity
was investigated. Those request captures alone did not establish the cause.

After per-execution skill delivery merged, a fresh pair on the same pinned logs
issue measured 7,588 start tokens with standard and 6,984 with lean: 604 tokens
saved. Both profiles now inherit Claude Code bundled-skill suppression from
skill delivery; lean adds Git-instruction removal and dynamic-section exclusion.
Both sessions passed the real CLI checks. This single pair is directional and
adds no new cache-reuse claim. The existing skill-pack proof also passed with
lean enabled for empty packs, 3 and 20 listed skills, invocation and pinned
bodies, confirming that the settings profile preserves skill delivery.


## Fill-first cache confirmation

On 2026-10-15, six fresh sandbox sessions at revision `7314258` reused the
recorded Jev route from the prior profile investigation, unchanged. Claude Code
2.1.300 ran three standard sessions followed immediately by three lean sessions.
Each process had a separate HOME and config, the same scratch repository and
allowed tools, and one identical no-tool task. The gateway management API reported
`fill-first` with session affinity enabled. No gateway configuration changed.

| Profile | Execution | First-turn cache read | Cache creation | Start context | Reported cost USD | Account |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| standard | 1 | 0 | 7,191 | 7,193 | 0.000907075 | A |
| standard | 2 | 7,191 | 0 | 7,193 | 0.000080110 | A |
| standard | 3 | 7,191 | 0 | 7,193 | 0.000080110 | A |
| lean | 1 | 0 | 6,614 | 6,616 | 0.000834950 | A |
| lean | 2 | 6,614 | 0 | 6,616 | 0.000074340 | A |
| lean | 3 | 6,614 | 0 | 6,616 | 0.000074340 | A |

All six sessions returned the exact expected answer in one turn with HTTP 200.
Their distinct native session IDs were preserved. Within each profile, captured
system, tools, and messages hashes stayed identical. `X-CPA-TRACE-ID` positively
attributed every response to the same account, anonymized here as A. The second
and third executions reused 100% of the cacheable prefix in both profiles. Lean
saved 577 starting-context tokens, or 8.0%, for this diagnostic tool set.

This confirms the locality condition for making lean the default. The earlier
functional and skill-delivery evidence above covers task behavior. This short
no-tool diagnostic isolates cache reuse and does not establish a general cost
advantage across coding tasks. Cache expiry, account failover, and prompt changes
can still cause misses. Select `launchProfile: standard` to use the base settings.

Session telemetry now records `gateway.desiredAccountPolicy`,
`gateway.strategy` with an observation time, and `gateway.responses`. Each
response has its HTTP status and either `response_trace` attribution with the
validated trace ID and opaque account slot, or `unavailable` attribution.
`kor calibrate report --context` shows observed strategy beside desired policy;
`--json` includes these observations in `gatewayRoutes`. Older metrics have null
gateway telemetry. Account health predictions remain `health_observation` and
are never promoted to response attribution.

After adding response telemetry, another six sessions returned the exact expected
answer and retained second- and third-execution cache hits: 7,192 reads with
standard and 6,615 with lean, with zero cache creation on those executions.
All six persisted trace IDs matched independently captured response headers.
The real CLI reopened their SQLite metrics and reported desired `fill-first`
beside observed `fill-first`, with response account A throughout.

The existing `scripts/skills-pack-proof.mjs` also passed five real sessions using
the default launcher: empty, 3 listed skills, 20 listed skills, invocation, and
pinned guidance. Start contexts were 6,595, 7,404, 8,339, 7,427, and 7,682 tokens.
Invocation added 1,252 context tokens against a 1,063-token body estimate.

A separate file task succeeded with both explicit standard and the lean default.
Each session used Read, Write, Edit, and Bash, produced the checked file value,
and reported zero permission denials. Start contexts were 7,284 and 6,705 tokens;
reported costs were $0.000873510 and $0.000777765 respectively.

After rebasing onto armed skill delivery, all three existing armed scenarios
passed under the lean default. The normal and repair sessions each fired
guidance on turns 2 and 4; the child-session scenario retained one child firing
and zero main-session armed loads. Two more real sessions forwarded responses
with the trace header removed or replaced by an unrecognized value. Both
succeeded, recorded unavailable account attribution, and left the strategy null
when no management observation was supplied.

Trace-derived response slots now use `account-trace-…`; adapter health rows use
`account-…`. These are separate identity namespaces and cannot be joined without
an explicit gateway inventory mapping.
