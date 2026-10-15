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

Read the brief, existing docs, repository policy and relevant implementation.
Keep established paths and terms. For a new project, use the paths below; only
README lives at the root. For an update, change the affected documents and their
dependants without rewriting unrelated decisions.

## Select the documents

For a full set, work through these templates one at a time. For a targeted edit,
read only the relevant templates. Templates are writing prompts, not executable
scripts or text to copy unchanged. Replace every prompt with project facts,
explicit proposals or an owned open question.

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

Read [claim traceability](references/claim-traceability.md) before writing.
Every rule, invariant and constraint needs a cited authoritative source beside
it and a row in `docs/claim-audit.md`. Check each claim against that source;
delete or correct claims without support. Existing docs are candidates to audit,
not authority for their own assertions. A general review is not this check.

- Assign stable `REQ-001` style IDs and observable acceptance to requirements.
  Carry those IDs into specs, interfaces and planned work. On a change, follow
  the IDs through affected docs, screens and tickets; record stale downstream
  artifacts for refresh. Preserve IDs and mark removed requirements superseded.
- Use a boundaries table and invariants for architecture. ADRs distinguish
  proposed, accepted and superseded decisions, with context and consequences.
  For an undecided new project, write a proposed ADR and its open question.
- Fix each domain term once in the glossary and reuse its spelling. Keep an
  open-question table with an owner, proposed default and what its answer blocks.
- Use relative Markdown links, including the document's directory and `.md`
  suffix, so cross-references open in the repository browser.
- Separate targets from observed behaviour. Derive commands from repository
  scripts or wrappers and run them where possible. Mark unrun commands as
  unverified and future commands as planned. Describe an absent interface as N/A
  with the reason in the contract document. A full set still accounts for it.
- Use real app screenshots in README and user instructions when the app exists.
  Before then, state that screenshots are pending. Label any linked mockups as
  designs; never fabricate captures, image links, ticket IDs or verification.
- Keep secrets and private identifiers out of examples and captures. Use
  runtime configuration names and public-safe synthetic data.

## Verify the set

Read the written files. Check that each brief constraint has a requirement or an
explicit non-goal, each requirement has acceptance and planned work, and contracts,
specs, architecture and glossary agree. Verify local links and screenshot files
exist; inspect real images when claiming screenshots. Remove template prompts and
empty sections. Finish the claim ledger: enumerate every rule-like statement,
check its cited source and record the result and any correction. Reconcile the
document claim IDs with the ledger; no unsourced or unchecked claim may remain.
Run [the claim-ID check](scripts/check-claim-ids.mjs) with Node from the project
root; a nonzero exit blocks completion. It checks README and `docs/`; use an
equivalent executed check for other established layouts.
Missing facts belong in open questions with a proposed default.

Finish with the document list, observed checks, unverified commands and remaining
decisions. Documentation completeness does not establish implementation or
tracker readiness.
