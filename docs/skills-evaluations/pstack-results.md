# Pinned guidance evaluation results

The 41 additions have three paired scenarios each: **123 pairs across 82 real Kor sessions**. The baseline passed 119/123 scenarios and the offered arm passed 123/123. Every item has nonnegative observed lift and all sessions completed with zero permission denials.

## Method and limits

The [runner](../../scripts/pstack-playbooks-proof.mjs) used the existing isolated session launcher and runtime gateway credentials. Jev selected a route per item from a candidate verified by a live compatibility probe. Both arms used that same item route. The three scenarios for an item were clustered into one session per arm. Arm order alternated. A separate Jev judgment received the task, answer, and criterion without arm labels or the skill body. The threshold was 0.5.

Session measurements used the launcher built from base commit `c97157eaa3ef0e47c7ee3439a2c7073a6f0caa68` with this branch's guidance bodies. The final rebased source passed the local integration checks listed below.

These are recommendation checks using supplied facts, with no tool actions requested. They establish neither live feature correctness nor automatic selection accuracy. Three cases per item, one observed execution setting, and a semantic judge are insufficient to establish a general improvement. Positive differences are sample observations.

The eight supporting skills and nine adapted playbooks are condensed procedures. The 22 principles include narrow additions from the pinned source. Test-authoring and unconditional autonomy procedures were excluded.

## Measured session telemetry

| Measure | Baseline | Offered |
| --- | ---: | ---: |
| Median session duration, ms | 9736 | 9603 |
| Minimum duration, ms | 6663 | 5563 |
| Maximum duration, ms | 19062 | 40804 |
| Median initial context, tokens | 3725 | 3929 |
| Session cost, USD | 0.359024 | 0.401742 |

Total reported session cost was USD 0.760766, excluding the compatibility probe and Jev calls. Duration is session telemetry, not total wall time. The sample uses short advice tasks with a strong baseline and no requested tools. There is no controlled performance or token-saving claim.

## Per-item results

| Guidance | Baseline | Offered | Pass-count difference |
| --- | ---: | ---: | ---: |
| `bespoke-playbook` | 3/3 | 3/3 | +0 |
| `blast-radius` | 3/3 | 3/3 | +0 |
| `build-feature` | 3/3 | 3/3 | +0 |
| `change-docs` | 3/3 | 3/3 | +0 |
| `correct` | 2/3 | 3/3 | +1 |
| `create-verification-skill` | 3/3 | 3/3 | +0 |
| `diagnose-bug` | 3/3 | 3/3 | +0 |
| `fix-bug` | 3/3 | 3/3 | +0 |
| `how` | 3/3 | 3/3 | +0 |
| `investigate` | 3/3 | 3/3 | +0 |
| `maintain-verification-skill` | 3/3 | 3/3 | +0 |
| `match-design` | 3/3 | 3/3 | +0 |
| `needs-input-protocol` | 3/3 | 3/3 | +0 |
| `principle-attack-the-premise` | 3/3 | 3/3 | +0 |
| `principle-boundary-discipline` | 3/3 | 3/3 | +0 |
| `principle-build-the-lever` | 3/3 | 3/3 | +0 |
| `principle-encode-lessons-in-structure` | 3/3 | 3/3 | +0 |
| `principle-exhaust-the-design-space` | 2/3 | 3/3 | +1 |
| `principle-experience-first` | 3/3 | 3/3 | +0 |
| `principle-explain-the-number` | 3/3 | 3/3 | +0 |
| `principle-fix-root-causes` | 3/3 | 3/3 | +0 |
| `principle-foundational-thinking` | 3/3 | 3/3 | +0 |
| `principle-guard-the-context-window` | 3/3 | 3/3 | +0 |
| `principle-laziness-protocol` | 3/3 | 3/3 | +0 |
| `principle-make-operations-idempotent` | 3/3 | 3/3 | +0 |
| `principle-migrate-callers-then-delete-legacy-apis` | 3/3 | 3/3 | +0 |
| `principle-minimize-reader-load` | 3/3 | 3/3 | +0 |
| `principle-model-the-domain` | 3/3 | 3/3 | +0 |
| `principle-outcome-oriented-execution` | 3/3 | 3/3 | +0 |
| `principle-prove-it-works` | 3/3 | 3/3 | +0 |
| `principle-redesign-from-first-principles` | 3/3 | 3/3 | +0 |
| `principle-separate-before-serializing-shared-state` | 3/3 | 3/3 | +0 |
| `principle-sequence-verifiable-units` | 2/3 | 3/3 | +1 |
| `principle-subtract-before-you-add` | 3/3 | 3/3 | +0 |
| `principle-type-system-discipline` | 3/3 | 3/3 | +0 |
| `prototype` | 3/3 | 3/3 | +0 |
| `refactor` | 3/3 | 3/3 | +0 |
| `sketch-types` | 2/3 | 3/3 | +1 |
| `technical-writing` | 3/3 | 3/3 | +0 |
| `typescript-best-practices` | 3/3 | 3/3 | +0 |
| `unslop` | 3/3 | 3/3 | +0 |

## Local acceptance checks

- Public lint: 49 entries, zero diagnostics.
- Catalogue: 49 entries, 0 duplicates, zero diagnostics.
- Full catalogue estimates: 1705 listing tokens and 19005 body tokens. These are character estimates, not always-loaded context.
- Public privacy guard passed with an isolated empty private configuration. This does not validate an operator-specific deny list.
- All 39 upstream file hashes matched the pinned Git objects. Every derived bundle retains the matching MIT notice.
- Repository build and typecheck passed. The existing lint proof passed 66 planted failures and its ordinary-prose, quotation, symlink, missing-file, and usage checks. No unit-test suite was added.

Scenario fixture SHA-256: `0b5f2b1758aada4735b85807e0b30b224387bf85026800e4ff5a604b4d9083fe`.

Raw sessions and judgments remain local because they contain execution paths and runtime details. Reproduce them with the committed runner, scenarios, and fresh Jev route records.
