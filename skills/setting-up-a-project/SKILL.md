---
name: setting-up-a-project
description: Sets up a project from a product brief. Use when starting a repository or preparing a project for implementation.
license: MIT
metadata:
  kor.kind: playbook
  kor.stages: project-setup,plan
  kor.triggers: start project; bootstrap repository; prepare implementation
  kor.anti: updating individual documents in an established project; implementing a single feature
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "1500"
---

# Set up a project

Work within the requested scope and repository policy. Inspect existing files
before creating anything; preserve established decisions, document paths and
working commands. Track each phase as complete, blocked or out of scope with
evidence in `docs/implementation-plan.md`. Documentation can finish while later
phases remain blocked. Report that distinction explicitly.

## 1. Establish the brief

Record users, goals, constraints, non-goals and measurable success in
`docs/brief.md`, preserving the owner's wording where supplied. Separate facts,
proposals and unanswered questions. Record each unknown with an owner and a
proposed default; decisions affecting scope or external actions need the owner's
answer before dependent work proceeds.

Exit: every supplied requirement is accounted for and unresolved choices are
visible, rather than silently invented.

## 2. Write the documentation set

Use `writing-project-docs` when available. Otherwise report that guidance as
unavailable and write from the brief and repository conventions. The set is:
README, brief, requirements, architecture, glossary, ADRs, feature specs, threat
model, development guide, user guide, interface contract, implementation plan and
open questions. Put documents under `docs/` except the repository README. For
inapplicable interfaces or unresolved architecture, document that status and its
reason rather than inventing an interface or claiming a decision is accepted.

Exit: each document has substantive project content, stable requirement IDs,
consistent terms and explicit planned versus implemented behaviour. Follow
requirement IDs across specs, contracts, risks and planned work to check agreement.

## 3. Inventory screens and render mockups

For a UI project, use `designing-screen-mockups` when available. Derive every
route/view, relevant state and supported viewport from the brief. Record the
screen-to-requirement inventory in `docs/mockups/INDEX.md`; render an actual PNG
for every inventory row and inspect it. Label mockups as designs. The README and
user guide use captures of the real app once it exists.

Exit: rendered rows / required rows = 100%, with no invented screens. A non-UI
project records this phase as out of scope with a reason. Missing rendering tools
or guidance are a recorded gap; a filename alone is no proof of a rendered image.

## 4. Prepare delivery work

Inspect the authorised Linear workspace and existing project before changes.
Use `using-linear`, `writing-linear-tickets` and `attaching-screens-to-tickets`
when available for the matching work. Create or update the authorised project,
milestones and dependency-ordered tickets, reusing existing records. Each ticket
has an outcome, requirement IDs, checkable acceptance and dependencies. Each UI
ticket carries its relevant images and captions; read it back to verify them and
record ticket IDs against inventory rows.

Exit: every requirement has planned work and every UI inventory row maps to a
ticket; UI tickets with verified images / UI tickets = 100%. Without tracker
authorisation, access or upload capability, save a local ticket plan and mark
publication blocked. Local plans are not published tickets.

## 5. Scaffold the repository

Within the authorised setup scope, add the repository's PR template (use
`pr-standard` if available), README entry points, CI and check commands. Derive
commands from the actual stack and run them before labelling them verified.
Prepare the Kor repository mapping, least-privilege tool allowlist and Linear
intake label; apply configuration only when authorised. Keep credentials outside
the repository. Leave unapproved configuration as a proposal.

Exit: documented install/run/check commands match the scaffold; observed results
and remaining integration requirements are recorded.

## 6. Review readiness

Read the resulting files and tracker records. Check links, requirement coverage,
screen coverage, ticket image coverage, dependency order and open decisions. If
`kor linear lint` is available, run it and address its findings; otherwise record
that readiness check as unavailable, never as passed. For non-UI work, report
screen and image coverage as N/A with the reason, not an empty 100%.

Exit: the implementation plan names the next actionable work and every unmet
gate with its owner. Declare setup ready only when all applicable gates pass;
otherwise report the completed phases and exact blockers.
