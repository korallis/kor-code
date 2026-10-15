# Playbook selection evidence

The original live 12-task fixture selected the expected procedure for every task. It used
the installed catalogue through `bin/kor skills list --estimate --json`, live
TypeSafe Choice judgments and the production pack builder. Bodies used the
catalogue's character-based token estimate.

| Task | Expected and selected | Tier | Body tokens |
| --- | --- | --- | --- |
| Checkout crash repair | `fix-bug` | pinned | 182 |
| CSV export feature | `build-feature` | pinned | 167 |
| Date formatting cleanup | `refactor` | pinned | 186 |
| Queue ownership report | `investigate` | pinned | 130 |
| Installation docs | `change-docs` | pinned | 157 |
| Throwaway layout experiment | `prototype` | pinned | 185 |
| Approved checkout baseline | `match-design` | pinned | 200 |
| Storage interface sketch | `sketch-types` | pinned | 186 |
| Save failure diagnosis only | `diagnose-bug` | pinned | 248 |
| New project preparation | `setting-up-a-project` | pinned | 1,237 |
| Exact ACK response | `none` | hidden | 0 |
| CSV feature with failing check | `fix-bug` | pinned | 182 |

The measured run made 12 Choice calls with median selection latency 200.0 ms.
Reported usage totalled 16,985 input and 1,643 output tokens. The largest pinned
body was 1,237 estimated tokens against the 1,500-token cap. Repeated identical
requests reused their audit record. Serialized audit replay preserved every
decision and plan. The repair used the feature execution's ID with a fresh
attempt and decision ID.

The runnable proof also checks no-procedure delivery, outage fallback, validated
overrides, unknown and denied names, stage and tool restrictions, body budgets,
and rejection of multiple or listed playbooks. Existing catalogue lint and its
rejection proof cover routing content at delivery boundaries.

A separate real execution used the production session preparation callback and
verification loop in an isolated scratch repository. Its initial CSV exporter
failed on empty input. The repair changed that check to pass while preserving
nonempty output, and Jev acceptance passed. Two distinct decisions selected
`build-feature` then `fix-bug`; the repair state included `check-failure` and
`acceptance-failure`. The execution route stayed unchanged across both sessions.
Total session cost was $0.20487675. The repair session took 23,458 ms and reported
9,440 starting-context tokens. These are whole-session measurements, not the
playbook's incremental cost.

That repair reported one denied shell call because it appended `echo` to the
permitted check command. The permission boundary held. Kor's authoritative
`node check.mjs` invocation subsequently passed, and the final report had zero
blockers. An earlier proof harness run also reached a passing check but lacked
explicit acceptance and its judge; only the fully configured run is counted
as passing verification here.

Reproduce from a built checkout with runtime TypeSafe credentials:

```sh
node scripts/playbooks-proof.mjs /tmp/kor-playbooks-proof
```

The fixture is a small acceptance sample, not a general accuracy benchmark or a
measurement of execution quality lift. Latency and token usage can change with
the catalogue and service. This script verifies decisions and packs without
launching execution sessions.

## Hard-problem selection and delivery

The extended fixture selected the expected procedure for **15/15** tasks. The
original 12 selections stayed correct. Three outcome-based prompts described
unknown extraction failure modes, competing latency improvements, and conflicting
model benchmarks without prescribing a research or review process. All three
selected `hard-problem-resolution`, pinned at 835 estimated body tokens:

| Task | Choice probability | Selection latency |
| --- | --- | --- |
| Extraction accuracy | 0.99 | 233.2 ms |
| Search latency | 0.91 | 220.6 ms |
| Model comparison | 0.99 | 213.8 ms |

Median selection latency across all 15 calls was 213.8 ms; reported usage was
23,339 input and 2,210 output tokens. Replay, fresh repair decisions, overrides,
fallback and delivery policy checks passed. Catalogue lint reported no diagnostics
for the new playbook; the existing lint proof passed all 73 planted cases.

A separate isolated Kor session received the selected body through the production
pack builder and session launcher. Jev chose its execution route from 34 verified
candidates still present in the live gateway catalogue. The first route judgment
was unapplied at 0.47 confidence. One narrower question, making measured latency
the objective, produced an applied route at 0.99; no execution setting was pinned
in the playbook or selection code.

The session ran a real duplicate-ID fixture with 10,000 rows and 5,000 queries:

| Approach | Correct queries | Query duration |
| --- | --- | --- |
| Linear first-match | 5,000/5,000 | 36.080 ms |
| Indexed last-match | 0/5,000 | 0.411 ms |

Index construction took 0.743 ms. The session identified the correctness cost,
separated measured results from untried alternatives, and explicitly handed off
the missing independent challenge and Jev technical choice without implementing
or inventing probabilities. Session duration was 36,606 ms, reported cost
$0.0995608, and starting context 2,803 tokens. Two optional shell searches were
denied; the permitted benchmark executed successfully. The proof wrapper's
initial zero-denial assertion failed; inspection of actual tool results confirmed
the benchmark and handoff, retaining both denials as limitations.

This session proves delivery, measurement and honest capability handoff. It does
not prove a completed cross-family review, a technical choice at 0.9, or a final
implemented improvement. Those remain requirements of the procedure when Kor
provides the necessary capabilities. The synthetic fixture is a single observation,
not a production performance result or an evaluation of outcome improvement.
