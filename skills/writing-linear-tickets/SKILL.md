---
name: writing-linear-tickets
description: Writes buildable Linear tickets. Use when creating, refining, splitting or reviewing issues and their acceptance criteria.
license: MIT
metadata:
  kor.trackers: linear
  kor.kind: skill
  kor.stages: plan,review,project-setup
  kor.triggers: create ticket; split issue; acceptance criteria; review ticket readiness
  kor.anti: routine tracker reads or status updates; implementing existing tickets
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "1500"
---

# Writing Linear tickets

## Separate facts from proposals

Treat unspecified authentication, data fields, endpoint method/path, date
boundaries, defaults and viewports as decisions. Label proposals and illustrative
IDs. Choices affecting acceptance block every affected ticket, including backend
work. Preserve existing contracts when revising requirements.

Without tracker tools, describe conditional searches and team discovery; claim
creation only after readback. Reuse verified states, labels, ownership and project
settings.

Report each ticket's specific blockers consistently with the final summary.
Readiness requires **all** blocking dependencies completed, **all** affected
inventory images attached and inspected, and **all** acceptance questions
resolved. Count route/state/viewport rows before recommending Todo; attach each
row's actual PNG without adding or dropping screens.

1. **Read the brief and existing work.** Preserve the owner's stated outcome,
   shared vocabulary and constraints. Search the target project for duplicates
   and read linked requirements. Gather the team's workflow, existing labels and
   ownership before writing to Linear; use the using-linear skill for operations.
2. **Bound one PR.** Give each ticket one independently verifiable outcome and
   one accountable owner. Split work when outcomes can ship independently or a
   prerequisite must land first. Record real blockers as dependencies, and group
   the parts under the project or parent. Include integration work explicitly.
3. **Map affected screens.** Enumerate routes, states and viewports the change
   touches. Select a matching image for every affected screen and state from the
   approved mockup inventory or real app. Caption each with route, state and
   viewport; distinguish current behaviour from the intended result. If an image
   or product decision is missing, record the gap and keep the ticket unready.
   Backend-only work says why screens do not apply. Never fabricate a screenshot.
4. **Draft the ticket** with the template below. Write acceptance as an observable
   result in the real app or an exact command and exit condition. Cover the
   changed failure and empty paths when applicable. Keep implementation hints
   subordinate to the outcome; do not turn uncertain ideas into requirements.
5. **Publish and read back.** After scope is settled, create or update the issue,
   attach the selected PNGs with `kor linear attach-image` and inspect the saved
   images. Preserve unrelated existing content. Read back descriptions, screen
   captions and dependencies. Review every ticket against the checklist before
   recommending Todo; incomplete work stays in the team's planning state.

## Template

```markdown
## Outcome
<One sentence describing the user's new capability or corrected behaviour.>

## Why
<Problem, affected user and links to the source requirements.>

## Screens
<Captioned image per affected route/state/viewport, or a backend-only rationale.>

## Acceptance criteria
- [ ] <Concrete trigger, observable result and how to verify it.>

## Out of scope
<Adjacent behaviour this PR leaves for separate work.>

## Depends on
<Blocking issue links and the condition each must satisfy, or None.>
```

Read [worked examples](references/examples.md) when converting vague requests
or splitting UI work. The examples are illustrative, not real project records.

## Readiness review

Check **every** ticket:

- The outcome traces to the brief; the title names the behaviour.
- Scope fits one PR and preserves the brief's constraints.
- Acceptance can fail observably, covers affected paths and states a verification
  method. Replace “works well”, “clean code” and “fully tested” with outcomes.
- Every affected screen and state has its intended image, route and caption.
  Verify actual image contents and access; an inaccessible URL is a gap.
- Blocking relations are correct and completed before execution. Cross-ticket
  requirements and integration have an owner; nothing disappeared in splitting.
- Out-of-scope text prevents adjacent work from silently entering this ticket.

Report issue links and specific unresolved gaps; placeholders do not establish readiness.
