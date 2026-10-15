# Project setup guidance

Kor bundles two public MIT guidance packages:

- `setting-up-a-project` is a playbook for turning a brief into implementation-ready
  work: brief, docs, screen inventory, rendered mockups, tickets, scaffold and
  readiness review. Each phase has an observable exit criterion.
- `writing-project-docs` writes the full documentation set or revises affected
  documents after a requirement changes. It reads one template at a time and
  preserves stable requirement IDs, terminology and existing decisions.

These are guidance files, not a project generator or a new CLI setup command.
They ship under `skills/` in the Kor checkout. This tier alone does not select or
deliver them to a running session. Jev's per-task route remains authoritative;
neither guidance package configures execution routing.

## Use with a coding session

Give the session your brief, repository policy and the relevant `SKILL.md` paths
from your Kor checkout. For example:

```text
Prepare this repository from the supplied brief using setting-up-a-project and
writing-project-docs from the Kor checkout. Read their SKILL.md files and only the
templates needed for the current document. Keep docs under docs/ except README.
Work only on local documentation in this pass; record later setup gates and
unanswered choices with owners. Do not publish tracker records or change machine
configuration in this pass.
```

For a focused docs change, supply `writing-project-docs` alone and the requirement
that changed. Follow the affected IDs through specs, contracts and the plan;
record screens and tickets that need refreshing. This does not require loading
the whole setup playbook or all templates.

## Documentation output

The default full set is:

```text
README.md
docs/
  brief.md
  requirements.md
  architecture.md
  GLOSSARY.md
  adr/NNNN-topic.md
  specs/feature.md
  threat-model.md
  development.md
  user-guide.md
  cli-contract.md or api-contract.md
  implementation-plan.md
  open-questions.md
```

Existing repository paths win. Requirements have stable IDs and observable
acceptance; architecture includes responsibility boundaries and invariants; ADRs
record context, decision, consequences and actual status. Open questions carry
an owner, proposed default and blocked work. Before an app exists, screenshots
remain explicitly pending. Once it runs, README and user guide use real captures.
An absent interface is accounted for with an N/A reason in the contract document.

## Readiness and verification

Documentation completion is one gate. A UI project's later gates require an
inventory of routes, states and viewports, inspected rendered PNGs for every row,
and relevant images on every UI ticket, verified by reading the ticket back.
Non-UI projects record screen gates as N/A with a reason. Tracker changes and
configuration require the appropriate authorisation and access.

The playbook can use the corresponding screen and Linear skills when installed;
it records missing guidance, rendering/upload tools and checks as gaps. It only
runs `kor linear lint` when that command is available. It never treats a local
ticket plan as published work or an unrun command as verified.

From a built source checkout:

```sh
bin/kor skills lint
node scripts/skills-lint-proof.mjs
```

Lint validates bundle format, links, budgets and routing restrictions. It does
not prove documentation quality. For behavioural acceptance, compare three
isolated scratch requests with guidance hidden and offered: a new project brief,
a spec-to-work handoff, and a changed requirement. Use the same Jev-chosen route
within each pair; inspect the actual documents for completeness, consistency,
truthful readiness and change propagation. Count permission denials and record
runtime, turns and token/cost telemetry when available. Small samples are
directional evidence. Mockup rendering and live tracker publication need their
own real-use evidence.
