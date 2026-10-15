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
route file constant. `standard` uses the P1-1 settings, not the original full
tool set. Both profiles keep the cockpit plugin. Each summary includes
`startContextTokens` and `cacheReadShare`, calculated across the session as
`cache_read / (cache_read + cache_creation)` (null when both are zero).
For back-to-back executions, compare the second repetition of each profile and
also inspect `turns[0]` to isolate reuse of the starting prefix. These are fresh
sessions with separate homes, not resumed conversations.

The run directory contains request bodies, a stream recording, summaries, `metrics.sqlite`, and a report. The standalone bench records the selected profile in each summary and uses the baseline arm without sampled pairs. Files have private permissions. Headers and credentials are never recorded. Request bodies and streams can contain repository content, so review artifacts before sharing them. `count_tokens` is called for each captured messages request with its original model, system, tools, messages, and Anthropic feature headers. Its count can differ from billed usage. HTTP failures and timeouts are recorded as unavailable counts.

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

Six live Claude Code 2.1.300 sessions compared `standard` and `lean` on the same
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
