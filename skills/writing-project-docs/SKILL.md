---
name: writing-project-docs
description: Writes a consistent project documentation set. Use when authoring project docs or revising them after requirements change.
license: MIT
metadata:
  kor.kind: skill
  kor.stages: project-setup,plan,execute,review
  kor.triggers: write project docs; document architecture; update requirements; document changed behaviour
  kor.anti: orchestrating repository setup; rendering mockups; publishing tracker issues
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "1500"
---

# Write project docs

Read the brief, docs, repository policy and relevant code. Preserve established
paths and terms; update affected documents and dependants. New projects use the
paths below; only README lives at root.

## Select documents

For a full set, read every template; targeted edits need only affected templates.
Replace prompts with facts, proposals or owned questions. Templates are not scripts.

| Output | Read when writing |
| --- | --- |
| `README.md` | [Project entry point](references/templates/readme.md) |
| `docs/brief.md` | [Users, goals and scope](references/templates/brief.md) |
| `docs/requirements.md` | [Numbered, testable requirements](references/templates/requirements.md) |
| `docs/architecture.md` | [Boundaries and invariants](references/templates/architecture.md) |
| `docs/GLOSSARY.md` | [Canonical terms](references/templates/glossary.md) |
| `docs/adr/NNNN-topic.md` | [Decision record](references/templates/adr.md) |
| `docs/specs/feature.md` | [Feature behaviour](references/templates/spec.md) |
| `docs/threat-model.md` | [Assets and trust boundaries](references/templates/threat-model.md) |
| `docs/development.md` | [Contributor workflow](references/templates/development.md) |
| `docs/user-guide.md` | [User tasks](references/templates/user-guide.md) |
| `docs/cli-contract.md` or `docs/api-contract.md` | [Interface contract](references/templates/interface-contract.md) |
| `docs/implementation-plan.md` | [Work and readiness](references/templates/implementation-plan.md) |
| `docs/open-questions.md` | [Owned unknowns](references/templates/open-questions.md) |

## Write from evidence

Read [claim traceability](references/claim-traceability.md). Cite authority beside
every rule, invariant and constraint; verify it and log the result in
`docs/claim-audit.md`. Correct or delete unsupported claims. Existing docs cannot
justify their own assertions.

- Give requirements stable `REQ-001` IDs and observable acceptance. Carry IDs
  through specs, interfaces and work plans. Follow changes through docs, screens
  and tickets; flag stale artifacts. Preserve IDs; mark removals superseded.
- Architecture needs a boundaries table and invariants. ADRs state context,
  consequences and proposed/accepted/superseded status. Undecided projects need
  proposed ADRs and open questions.
- Define canonical terms once in the glossary. Open questions need an owner,
  proposed default and blocked work.
- Use relative Markdown links with directory and `.md` suffix.
- Separate targets from observations. Derive commands from scripts or wrappers;
  run them where possible. Label unrun commands unverified and future commands
  planned. Account for absent interfaces as N/A with a reason in the contract.
- Use real app screenshots in README and user instructions. If the app is absent,
  mark captures pending and label mockups as designs. Never fabricate evidence.
- Keep examples and captures public-safe: runtime configuration names, synthetic
  data, no secrets or private identifiers.

## Verify the set

Read the files. Each brief constraint needs a requirement or non-goal; every
requirement needs acceptance and planned work. Reconcile contracts, specs,
architecture and glossary. Verify links and screenshot files; inspect claimed
captures. Remove prompts and empty sections.

Complete the claim ledger: enumerate every rule-like statement, verify sources,
record corrections and reconcile document claim IDs. Resolve every unsupported
or unchecked claim. Run [the claim-ID check](scripts/check-claim-ids.mjs) with Node
from the project root; nonzero exit blocks completion. It checks README and
`docs/`; execute an equivalent for other established layouts. Missing facts go
in open questions with proposed defaults.

Report documents, observed checks, unverified commands and remaining decisions.
Documentation completeness does not prove implementation or tracker readiness.
