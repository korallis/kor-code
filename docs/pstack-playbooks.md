# Use the bundled principles and playbooks

Kor bundles 22 pstack principles, eight supporting skills, nine session playbooks,
and two original operational playbooks. They use the same public catalogue as
Kor's code, PR, and Linear guidance. Inspect them with the built CLI:

```sh
kor skills list --estimate
kor skills show fix-bug --estimate
kor skills lint
```

From a source checkout, use `bin/kor` after installing dependencies and building.
The files ship with Kor; no separate plugin installation is required. This content
change makes them discoverable in the catalogue. Session selection and delivery
remain the responsibility of Kor's decision and execution layers.

## Session playbooks

Each entry has `kor.kind: playbook`, stage metadata, triggers, exclusions, and a
1,500-token body budget. Only the applicable procedure needs to be loaded.

| Name | Deliverable |
| --- | --- |
| `investigate` | A read-only report with evidence, recommendation, and limits |
| `fix-bug` | A minimal causal fix verified on the original surface |
| `build-feature` | Scoped behavior with acceptance evidence |
| `refactor` | A structural change with observed behavior equivalence |
| `prototype` | An isolated throwaway artifact that resolves a design question |
| `match-design` | State-by-state comparison against a fixed approved baseline |
| `change-docs` | Documentation checked against actual behavior |
| `bespoke-playbook` | A bounded phase list, hypothesis loop, and decision record |
| `sketch-types` | Caller usage, interfaces, and ownership before logic |
| `diagnose-bug` | A reproduction and supported causal explanation before a fix |
| `needs-input-protocol` | An evidence-based decision or a concrete open question |

`fix-bug` uses `diagnose-bug` for causal work. A diagnosis-only request ends at
the report. `needs-input-protocol` distinguishes observable facts and authorized
reversible choices from product decisions or irreversible actions that need input.
It records an open question through an available authorized channel and leaves
blocked state and notification handling to Kor. It grants no new write authority.

Shipping, orchestration, session recovery, and cleanup supervision remain in Kor's
controller and daemon. These playbooks do not prescribe execution settings.

## Principles and supporting skills

The principles cover domain and type design, boundary ownership, small changes,
reader load, causal fixes, direct verification, structural prevention, context
size, experiment design, measurements, migration sequencing, and shared state.
The added upstream principles retain narrow triggers rather than becoming one
always-loaded style guide.

Supporting skills are `typescript-best-practices`, `correct`, `blast-radius`,
`unslop`, `technical-writing`, `create-verification-skill`,
`maintain-verification-skill`, and `how`. Verification generators write to Kor's
public tier or an explicitly configured private tier. Their feature references
stay inside the generated bundle and their proof survives cleanup.

The upstream test-authoring principle is excluded to respect repository test
policy. The unconditional autonomy principle is excluded because existing
authorization and explicit approval gates take precedence. React guidance is not
in the pinned pstack tree and is not represented as a pstack import here.

## Review the upstream pin

[Attribution](../skills/PSTACK-SOURCES.md) and
[the adaptation manifest](../skills/pstack.lock.json) record the full source pin,
source-file hashes, adapted-file hashes, and MIT license evidence. Each derived
bundle retains its upstream notice.

`pstack.lock.json` is a content-review manifest for authored adaptations, distinct
from the `skills.lock.json` managed by `kor skills add` and `update`. Generic
`update --apply` cannot safely recreate these edits. To refresh them, compare the
pinned upstream files, review the adaptations, update their hashes, and repeat
lint and paired evaluation. Do not present the adapted bodies as byte-for-byte
upstream imports.

## Reproduce the paired evaluations

Build Kor, then supply a JSON object keyed by each skill name whose values are
recorded Jev routes. Both arms use that task's same route. The proof never picks
an execution setting. Runtime credentials come from the normal Kor gateway and
TypeSafe environment files and are not written into the output.

```sh
node scripts/pstack-playbooks-proof.mjs /tmp/jev-routes.json /tmp/pstack-proof
```

Optional trailing skill names select a subset. Keep output outside the checkout.
The runner creates fresh isolated sessions, alternates baseline and offered order,
and presents the same three scenarios to each arm. The baseline omits the skill;
the offered arm receives its body. Each session answers the three independent
situations together. These are three paired scenario evaluations clustered in two
sessions per skill, not three independent sessions per arm.

[The scenarios](skills-evaluations/pstack.json) contain the prompts and criteria.
The session sees the prompts, while a separate Jev judgment checks each response
against its criterion without arm labels or the skill body. A probability of at
least 0.5 counts as satisfying the criterion. The runner retains raw sessions,
judgments, durations, costs, context counts, denials, and per-scenario verdicts.
It exits unsuccessfully for missing responses, session failures, denials, an
offered failure, or negative lift.

The proof also checks installed adaptation and license hashes. It evaluates
recommendations from supplied facts. It does not establish end-to-end feature
success, visual parity, generated-tool correctness, or automatic skill selection.
A zero lift on three scenarios means no observed regression in this sample;
it does not establish improvement or performance on other tasks.

The [recorded results](skills-evaluations/pstack-results.md) include per-item
verdicts, session telemetry, acceptance checks, and the limits of this sample.
