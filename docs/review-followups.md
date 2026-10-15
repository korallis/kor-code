# Review follow-ups

This audit covers all 93 supplied reports, including the foundation, feature and
recheck reports through review 67 and the pilot report. Findings were checked against main at `30010cd`.
Rechecks supersede the original finding where they verify its correction.

## Surviving defects corrected

| Area | Review finding | Correction |
| --- | --- | --- |
| Skills catalogue | 52 P2-1 | `index --from` inspects explicit sources without replacing the installed catalogue. |
| Skills catalogue | 52 P2-2 | Token counting runs in groups of eight, retaining local estimates for private and explicit sources. |
| Skills privacy | 55 duplicate public import/demotion | Identical public copies cannot be imported privately; existing identical private copies do not demote the public entry or trigger guard failures. Modified explicit overrides remain supported. |
| Skills privacy | 55 non-skill folders, substring matching, localized Git | Skip private notes/hidden folders; match complete private names; use a stable Git diagnostic locale. Literal `deny.txt` matching remains available. |
| Skills lint | 44 path escape false positive/uppercase Markdown; 49 UTF-16/NUL and routing gaps | Recognize path-looking tokens without rejecting newline escapes, scan Markdown extensions without case sensitivity, decode BOM-marked UTF-16, reject NUL text/executables, and recognize the reported unhyphenated routing instructions. Binary assets remain allowed. |
| Skills CLI | 44 short help; 53 source/update diagnostics | Accept `lint -h`; preserve local-source restrictions, report removed upstream subpaths, render readable diff statistics, and use operation-neutral recovery instructions. |
| Skills startup | 64 invalid configured names | Validate the catalogue and repository `always`/`pins`/`never` names before accepting work. |
| Skills replay | 64 outage replay; 65 procedure limit/override | Preserve outage audits and retry with fresh IDs. Offer every eligible playbook within the API limit; fail explicitly above it. Explicit overrides avoid an unused Jev call. |
| Shipped guidance | 56 missing screen key; 59 claim checker; 61 dangling paragraph | Add screen keys to Linear examples, read the claim ledger's fourth-column result despite trailing columns, emit JSON failures for missing documents, and remove the broken paragraph with its lock hash updated. |
| Armed guidance | 63 abandoned lock | Recover a lock older than ten seconds when its owner is gone, retaining live-owner locks. Document the snapshot hash's corruption-detection boundary. |
| Outcome learning | 66 F2/F3/F4 | Correct the baseline proof's route assertion, skip no-skills sessions when no guidance was offered, index report lookups and load only skill decisions for learning. Historical runs/metrics still contribute to reports. |
| Jev contracts | 15b N2 | Allow candidate-count-scaled rounding error in Choice distributions while rejecting a zero total. |
| Jev redaction | 26 C | Redact gateway-key spellings, Basic authorization and URL userinfo from state, diagnostics and audits. |
| Routing recovery | 18e S1/S2; 25 fingerprint/outage | Audit catalogue failures, recover partial audit pairs, fingerprint redacted state consistently, and retry outage decisions while preserving healthy replay. |
| Tool selection | 58 browser naming, duplicated task, outage | Gate hyphenated browser MCP and plugin names; send the task once per pending question batch; retry after outages. |
| Model registry | 10/10b/10c failed rows and verification flag | Recompute verification from required capabilities, normalize missing capability maps, and expose failed probes through `models list --all` with redacted errors. |
| Readiness | 28 missing verified route; 47 passing reasons/order | Give an actionable model-probe reason, omit repair instructions on passing checks, and enforce deterministic screenshot requirements before paid routing. |
| Launcher recovery | 6b N1/N2; 16d R2 | Abort the standalone session after lease failure; recreate only an ownership-marked missing worktree; protect recycled zombie PIDs and verify orphan group membership using the execution marker. |
| Context | 50 file-list overflow | Drop optional file hints on Git buffer overflow instead of failing the dispatch. Label rule snippets as opening excerpts and tell sessions to read the full files. |
| Calibration | 18/18b baseline liveness; 50 screenshot parity; 66 wasted arm | Bound each baseline by the configured check timeout, copy downloaded screenshots to its worktree, and avoid an empty no-skills comparison. Sampling still holds the execution permit while baselines run. |
| Session telemetry | 67 account identity and synthetic errors | Separate trace-derived `account-trace-…` labels from adapter-health `account-…` labels. Missing result events no longer invent `result.is_error`. |
| Linear webhooks | 3b N1/N2 | Queue Issue IDs and Comment issue IDs according to delivery type; reserve conflict responses for actual delivery digest conflicts. |
| Linear durability | 3/3b outbox; 9b manifest; 39 poison writes | Keep manifest status consistent; preserve failed writes and per-issue order while draining independent issues, including those behind more than 100 failed writes. Intake/shipping continue. |
| Linear images | 54 attachment limit; 56 fenced examples | Paginate the full attachment history and preserve fenced screen examples during named-screen replacement. Historical attachments remain available. |
| Shipping | 20 N2/N4/N5; 20b R1/R2/R3 | Stop polling settled terminal rows; use consistent issue-key branches; synchronize CI-only evidence changes; explicitly block and name verified excluded files; retain failed cleanup with evidence and an operator instruction. |
| Shipping integration | 30 optional submission metadata/status spelling | Fall back to the run head when submission metadata is absent and recognize the actual interrupted-CI status. |
| Shipping templates | 51 symlink and recursive substitution | Accept regular Git blobs only and expand placeholders in one pass so inserted evidence remains literal. |
| Mission Control | 28 missing web build; 41 persistent token; 42 stale address | Return the build instruction for an absent web root, describe the persistent token accurately, and verify the saved daemon process identity before sending it. |
| Installer | 42 streamed execution/tag/errors | Wrap streamed installation in `main`, support exact-tag updates, preserve Git diagnostics and remove stale private-repository/update wording. Document retained caches. |
| CLI diagnostics | 21 unavailable logs and calibration usage | Missing logs fail explicitly; calibration help works and malformed report options/timestamps exit 2. Invalid sample rates identify the argument. |
| Verification library | 26 B | A denial cannot complete a non-semantic library run without semantic verification. Production semantic judgment remains unchanged. |
| Documentation | 28 legacy status/SQLite; 58 doctor ceiling; 64 policy pointer | Document the unauthenticated legacy loopback status route, required SQLite function, configured tool ceiling and skill policy. Document build-before-typecheck on fresh source checkouts. |

## Findings already corrected on main

These were checked and left unchanged, rather than reimplemented.

| Reports | Disposition |
| --- | --- |
| 1, 2, 4, 4b, 4c | Foundation isolation/build changes, typed Jev contracts/audits, shared status contracts and cockpit corrections are present. Later rechecks supersede the original failures. |
| 3, 3b | Signed webhook shape, replay window, deduplication and workflow mapping are present. The remaining dispatch/outbox findings are corrected above. |
| 5, 5b, 5c | Management authentication/backoff, account-health shape, non-SSE terminal handling, bounded retries, gateway environment support and public-fact redaction are present. Account slots remain observations owned by the proxy. |
| 6, 6b | Provider limiting, evidence-gated completion, gateway credentials and per-execution homes are present. The remaining lease/worktree findings are corrected above. |
| 7, 8, 8b, 8c | Credential boundaries, redact-before-cap diagnostics and duplicate audit-ID validation are present. |
| 9, 9b, 9c | Evidence cannot be overwritten inconsistently, failures dominate passes, foreign evidence blocks, retries are documented and context overrides are correctly described. |
| 10, 10b, 10c | Structured results are parsed and error results rejected; the remaining registry/list issues are corrected above. |
| 11, 11b, 12, 13, 13b | Nondefault gateway URL forwarding, symlink invocation, repository bindings and verification failure reasons are present. |
| 14, 14b, 15, 15b | Live comment/session IDs, GraphQL shape, workflow/rate-limit handling, clarification-comment updates, route eligibility and audit validation diagnostics are present. |
| 16, 16b, 16c, 16d | Durable status identity, schema/provenance, Host checking and live recycled-PID protection are present. The residual orphan/zombie case is corrected above. |
| 17, 17b | Configured Linear teams, session cockpit environment, bounded cockpit reads, proof entrypoint and gateway provenance are present. |
| 18, 18b, 18c, 18d, 18e | Retry calibration, abandoned-outcome clearing, route labels/decision IDs, population labels and post-primary Linear writes are present. Remaining baseline/replay defects are corrected above. |
| 19, 21, 23 | CLI asynchronous failures enter the structured error handler. The obsolete supervisor adapter was removed, so its symlink/poll findings no longer apply. |
| 20, 20b, 24, 24b | Verified publication paths, redacted public evidence, durable shipping cancellation/retry and restart isolation are present. Remaining omission/cleanup/poll findings are corrected above. |
| 22, 22b | Selective plugin restoration, isolated validation and installation idempotence are present. Retained pre-existing configuration remains intentional. |
| 25, 25b, 27 | Intent revisions, durable verification-attempt numbering and the CI isolation changes are present. Remaining outage replay defects are corrected above. |
| 26, 48 | Scoped Glob/Grep and configured tool ceilings are enforced; no extra permission aliases are added here. |
| 28, 29, 38, 38b, 39 | Mission Control screen, security and styling findings passed their rechecks. Durable actions already return success despite a later outbox failure; independent-issue progress is corrected above. |
| 30, 31, 31b, 32, 34 | Pipeline attachment, corrected motion codec declarations, runner change and live attachment GraphQL shape are present. The offline flattened attachment fixture is corrected here. |
| 42, 43 | Reversible source installation and licensing are present; remaining installer/identity defects are corrected above. No license/style-only changes are needed. |
| 44, 49 | Routing-lint false-positive improvements and explicit-routing enforcement are present. Encoding and unhyphenated gaps are corrected above. |
| 45, 46, 47, 50 | Byte-budget naming/repair bounds, measured context telemetry, screenshot presence checks and context hints are present. Dense-content rejection and baseline image parity are corrected above. |
| 51, 52, 53, 54 | Public PR sections, import uninstall/edit protection and normalized-caption deduplication are present. Remaining catalogue/template/diagnostic/image defects are corrected above. |
| 55, 56, 57, 58, 59, 60, 61 | Private-pack boundaries, screen replacement, execution-local delivery, production skill wiring, project-doc guidance and launch profiles are present. Remaining findings are corrected above. |
| 62 | The final recheck confirms catalogue-outage fallback, model families, unknown thinking capability and interrupted-probe child cleanup. |
| 63, 64, 65, 66, 67 | The armed child-session crash was already corrected. Remaining guidance/replay/report/telemetry defects are corrected above. |
| pilot | Its three reviewed cost, CLI-validation and canceled-phase corrections are already present. |

Style-only comments, historical review-branch conflicts and requests for new unit
suites do not produce changes. Deliberate documented behavior is retained:
unknown workflow types fail closed; canceled dependencies do not imply completion;
explicit route overrides bypass semantic readiness; unavailable acceptance judgment
blocks completion; title/template policy remains operator-visible; binary assets,
private full-visibility opt-in and moving source-install branches remain supported.
Generic complete private names can still collide with ordinary prose. The shared
shell tool question is still observational. Separate skill/playbook decisions
still receive the task needed to judge their own candidates.

## Measured validation

All runs used disposable state. Live session routes came from Jev. Credentials,
private issue identifiers, signed asset URLs and local evidence paths are omitted.
No new test files or suites were added.

| Run | Observed result |
| --- | --- |
| Real gateway catalogue count | 49/49 skills counted, zero estimates, 7,185 ms. |
| Loopback count concurrency probe | 119 requests for 49 skills; peak eight concurrent requests; 1,014 ms. This measures concurrency, not provider performance. |
| Real launcher sessions | Three sessions: 6/6/4 requests, initial contexts 6,679/6,679/5,204 tokens; total reported cost $0.00525842. Child arming recorded one child firing and zero main-session armed loads. |
| Live Jev dense diff | First request rejected at 72,203 state bytes; one bounded retry at 29,915 bytes passed with zero blockers. Two calls, one rejection. |
| Real Linear pagination | A disposable issue with 101 existing attachments accepted and read back a 68-byte PNG in 1,791 ms. Issue deleted after proof. |
| Real Linear fenced screen | Fenced example unchanged; exactly one actual named screen added/read back in 1,806 ms. Issue deleted after proof. |
| Real armed-hook process | Dead-owner lock recovered in 53 ms; exactly one firing. |
| Real Linux process/Git probes | Owned orphan descendants stopped; unrelated vacated/recycled/zombie groups survived; missing owned worktree recreated without global pruning. |
| Mission Control in Chrome | Live empty workspace rendered, token fragment consumed; missing web root displayed the explicit `run pnpm build` response. A stale-address probe delivered zero token-bearing requests to an unrelated process. |
| Production controller probes | Lease loss aborted the launcher; baseline screenshot bytes matched the primary; no-guidance execution skipped the no-skills arm. Launcher/Jev/image responses were fixtures in these probes. |
| Durability and policy probes | 110 poisoned writes retained while an independent issue drained; healthy decisions replayed; outage decisions recovered; 13th playbook override made zero Jev calls; explicit scans preserved catalogue bytes. |
| Existing proofs | Calibration, verification, daemon, shipping, context, controller fixture, skills fixture and 66-case lint proof passed. Service/forge responses in offline proofs remain fixtures. |

Source builds and typechecks run after implementation. The real installer Git
probe covers initial exact-tag clone and repeat update; prerequisite/build tools
and installed payload were fixtures. Shared service management, a real systemd
install, a live forge merge and private-pack semantic quality are outside these
measurements. Outcome-report lookups are cheaper, but historical runs/metrics
still grow with stored history; no claim of constant-time reporting is made.
