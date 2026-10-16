# Jev decision audit — LEE-1335

## Production evidence and root causes

The audit used a SQLite online backup of the owner's database opened with
`mode=ro`. The live database was never written. Raw issue text, database copies,
credentials and replay scripts are not committed. Task proof artifacts live in
the assigned `firstmate/data/kor-jev-audit` directory.

The snapshot contains 115 decisions. “Confidence” below is the stored field:
Core Choice/Score use provider distribution concentration; skills/playbooks
store the leading (averaged for skills) candidate probability. Old Nouls store
P(yes). A small Noul is often a correct negative, not an uncertain answer.

| Decision | Inputs and candidates before this change | Threshold and fallback | Observed mean (n) | Root finding / repair |
| --- | --- | --- | --- | --- |
| Intake | User message, bounded live-run summaries; intent/topic/action choices with written criteria | .70; uncertain/unavailable takes no action | .854 (8) | Retain scoped choices and action policy. Whole-project intent is LEE-1325, a separate change. |
| Readiness | Full issue, acceptance, dependencies and checks; ready/blocked Noul | P(ready) >= .70; five of eight refused despite passing deterministic checks | .661 (8) | Symmetric positive gate confused uncertainty with missing scope. New records use a .90 negative scope veto; deterministic failures still block. |
| Complexity | Full issue plus irrelevant model metadata; three ordered levels from bounded to cross-system | 0, advisory score | .383 (8) | Isolate scope question and give concrete levels. Feed score and distribution to class selection. |
| Risk | Same oversized shared state; three levels from low to high risk | 0, advisory score | .460 (8) | Distinguish actual authorization/data-integrity changes from the application's subject matter. Feed assessment into class selection. |
| Route | Six model identities with effectively identical transport flags and incomparable probe observations; controller path omitted criteria | .70; configured Sonnet fallback on 8/8 decisions | .263 (8) | No task-role distinction or class hierarchy. Now class first, then only in-class profiles with explicit strengths/exclusions; verified conservative fallback retains its reason. |
| Agent | Generalist/specialist roster and generic role descriptions | .70; unapplied preference; dispatcher did not use it as a readiness gate | .600 (8) | Clarify that ordinary implementation, diagnosis and existing-PR review fit generalist; specialist is explicit research/domain-specialist work. Custom roles retain explicit “capabilities undeclared” criteria. |
| Context | Bounded issue and repository path/purpose/content hints; source IDs with null criteria | 0, advisory ranking; outage silently retained deterministic ordering | .683 (3) | Add path/purpose relevance criteria. Core audits outages; manifest reports fallback ordering. Mandatory rules remain mandatory. |
| Tools | Four capability Nouls; task attached only to first pending question | P(yes) >= .80; lean tools; every negative appeared escalated | .453 (28) | Put task in every question, including partial replay. Apply supported no at P(yes) <= .20. Policy-absent tools record deterministic no without an API call or fabricated confidence. 21/28 old P(yes) values were below .80; that is not 21 outages. |
| Skills / legacy skill | Task, stage, stack, eligible skill summaries/anti-goals/triggers; two shuffled Choices | Averaged per-skill probabilities: pin .80, list .25, arm .15; budgets/permissions; outage loads repository always only | .595 (7 skills; no scalar-skill records) | Retain purpose-built distribution/budget policy; low top probability need not block useful guidance. Privacy constraints remain. |
| Playbook | Task, phase/failure, procedure summaries/exclusions/triggers, none | 0; single procedure within body budget; outage loads none | .683 (7) | Retain the narrow procedure choice and explicit outage provenance. |
| Acceptance | Diff, authoritative checks, real/denied session evidence; one yes/no per criterion, originally batched | Positive P(yes) >= .70; missing/failed evidence blocks | .180 (22) | These were evidence failures, not grounds to lower acceptance. Ask separately and persist the actual question and criteria; preserve the positive gate. |
| Independent review route | Exact change, writer family and available model metadata; model names without criteria | .70; no suitable reviewer blocks merge | No snapshot records | Require independent deep-class verified models, review-specific role criteria and a no-suitable-reviewer outcome. Singleton pools are valid binary suitability decisions. |
| Merge | Exact head, independent review/findings, checks, summary; merge/wait Noul with criteria | Positive P(safe merge) >= .90 plus deterministic policy | No snapshot records | Retain positive evidence and independent-family/check gates. Missing evidence never becomes permission. |

The client default was Jev 1.13; it is now 1.14. Model compatibility probes do not
measure reasoning quality. Maintained profiles are explicit operator routing
policy, not provider benchmarks. Cost/speed tiers are qualitative policy; observed
probe dollars and milliseconds are labelled observations. Context windows remain
unknown. Exact model identities prevent accidentally assigning a new release an
unverified reasoning tier.

Question state is now scoped to the decision. Full routing identity lives in
audit inputs/fingerprints; an in-class model choice no longer sees out-of-class
profiles as competing options. Each independent successful answer persists before
an outage is surfaced. Immutable replay retains the original Noul policy. Changed
routing policy/profile inputs get a new revision; partial outages can be retried
without overwriting old records. One route materialization function handles fresh
plans and durable replay so fallback provenance survives retries.

## Design research and challenge

Primary guidance: [Choice](https://docs.typesafe.ai/primitives/choice),
[Noul](https://docs.typesafe.ai/primitives/noul),
[confidence](https://docs.typesafe.ai/confidence), and
[hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification).

`claude-fable-5-1` identified indistinguishable model candidates, a symmetric
readiness gate and missing tool state. Its research response hit its output cap;
its assumptions and incomplete ending were retained as such. `gpt-6-astra`
independently challenged it: probes do not establish quality; shared state is a
risk, not proof of contamination; equivalent models should not acquire invented
certainty; preserve acceptance/merge and distinguish errors from uncertainty.
The challenge favored deterministic selection within a semantic class. The final
proposal retains model Choice where maintained task roles differ, and makes
uncertain class/model fallbacks explicit.

Jev 1.14 was given both reports, corrected confidence semantics, the research
truncation, costs/risks and the owner's explicit version/proof requirements.
An initial comparison with the legacy flat design selected the hierarchy at 1.00.
The narrower decision compared role criteria with selecting solely by tiny-probe
costs: `hierarchical-profiled` .99, `class-then-deterministic` .01; Choice confidence
.98. The question asked whether task-role criteria or probe cost alone was the
relevant within-class evidence, explicitly forbidding invented capability facts.
No class/model confidence thresholds were reduced to make the replay pass.

## Live read-only Matilda replay

All ten issues were read with the owner's runtime credentials. No Matilda issue
was changed or executed. The five additional issues cover parsing, knowledge,
status, backups and CI operations; all ten had passing deterministic dependency
checks. The final scoped run used Jev 1.14 and the live available verified registry.

| Issue | Effective class | Class confidence | Chosen model | Model confidence | P(ready) | Source |
| --- | --- | ---: | --- | ---: | ---: | --- |
| LEE-1193 | deep | 0.91 | gpt-6-astra | 0.95 | 0.59 | jev |
| LEE-1196 | deep | 0.95 | gpt-6-astra | 0.99 | 0.88 | jev |
| LEE-1197 | deep | 0.97 | gpt-6-astra | 1.00 | 0.94 | jev |
| LEE-1220 | implementation | 0.91 | claude-sonnet-5-5 | 1.00 | 0.94 | jev |
| LEE-1224 | deep | 1.00 | gpt-6-astra | 1.00 | 0.77 | jev |
| LEE-1235 | implementation | 0.80 | gpt-6.1-sol | 1.00 | 0.83 | jev |
| LEE-1252 | deep | 0.64 | claude-opus-5-5 | 1.00 | 0.58 | fallback |
| LEE-1302 | implementation | 0.95 | gpt-6.1-sol | 1.00 | 0.67 | jev |
| LEE-1307 | deep | 0.43 | claude-opus-5-5 | 0.95 | 0.38 | fallback |
| LEE-1312 | deep | 0.28 | gpt-6-astra | 0.65 | 0.46 | fallback |

Readiness passed 10/10. Conditional model confidence cleared .70 on 9/10;
class confidence cleared .70 on 7/10. Four different models were allocated.
LEE-1252 and LEE-1307 use a labelled deep-class fallback; LEE-1312 also retains
model uncertainty and a conservative Astra fallback. These are not reported as
confident Jev selections. A previous iteration received an invalid upstream
Choice; typed validation rejected it and recorded the fallback. These ten issues
are operational evidence, not a confidence-calibration or reasoning benchmark.

Each issue also went through live intake, tools, context-hint ranking, the actual
bundled skills catalogue, playbook, acceptance, independent-review routing and
merge judgment. Historical acceptance evidence was replayed where available;
elsewhere the state explicitly said no implementation had occurred. Unproven
acceptance and merge remained blocked. Context replay uses issue/file hints, not
an invented checkout or new Matilda execution. The isolated run below provides
real repository context, diff and successful implementation evidence.

## Isolated execution and safety checks

A real daemon/controller/coding session ran in a throwaway HOME and standalone
throwaway repository for LEE-1338 in a newly created Linear project. To respect the
shared worktree administration ban, the local manager made a branch in that
already isolated repository; it did not register or alter any shared worktree.
Jev chose `routine` / `claude-haiku-5-5`; the worker created and committed the exact
`hello.txt` artifact, the real repository check passed, and all three evidence-based
acceptance Nouls passed (.93/.98/.96). The run reached `waiting` at the configured
publication approval gate. No code was published or merged. Session spend was
$0.0015. The temporary Linear project was archived to restorable trash via the
current API's `projectDelete` operation (`projectUnarchive` restores it).

The production independent-review path then inspected that exact committed diff
and the actual repository check. Jev selected the independent GPT-family Astra
reviewer at .98 confidence; its real review approved with no findings. The merge
judgment still returned `wait` at P(safe merge)=.17 with the deterministic GitHub
checks gate failed: this local proof had no published PR or GitHub checks.

Chrome DevTools AXI displayed the real run, actual session output, passing checks,
acceptance and explicit decision fallback reasons in Mission Control. Screenshots
and snapshots stay with task proof material.

Additional runtime checks demonstrated zero Jev calls on immutable replay;
missing essential scope blocked at P(ready)=.01; missing acceptance still blocked;
a tools policy with no optional capabilities made zero Jev calls and no fallback;
and an injected single-request outage preserved three successful answers and all
six audit records without duplicates. A serving-path replay recovered from that
outage under a new revision, then made zero API calls on identical retry and
retained readiness after operator guidance. Missing acceptance, incomplete
dependencies and missing UI screenshots blocked even during an outage. Direct
controller dispatch recognized supplied screenshots and retried outage records;
an unavailable model fallback retained the actual model's class and effort.
Credentials were read into process memory,
never printed or saved in proof artifacts. No user configuration was changed.

Validation: workspace build, workspace typecheck, real ten-issue replay and the
isolated execution. No new tests were added. Project-wide drive behavior belongs
to LEE-1325 and model auto-probing to LEE-1324.
