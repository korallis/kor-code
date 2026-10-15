# Playbook selection evidence

The live 12-task fixture selected the expected procedure for every task. It used
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
