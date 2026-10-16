---
name: writing-github-tickets
description: Writes buildable GitHub issues. Use when creating, splitting or reviewing tickets for GitHub-tracker projects.
license: MIT
metadata:
  kor.kind: skill
  kor.trackers: github
  kor.stages: plan,review,project-setup
  kor.triggers: create ticket; split issue; acceptance criteria; review ticket readiness
  kor.anti: routine tracker reads or status updates; implementing existing tickets; Linear projects
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "1500"
---

# Writing GitHub tickets

Read the brief, repository policy and existing issues before publishing. Preserve
the owner's requirements and distinguish decisions from proposals. Unspecified
contracts, authentication, defaults and viewports remain owned questions; any
choice affecting acceptance blocks the affected work, including backend tickets.
Use `using-github` for operations and Projects v2 field discovery.

1. Search the repository and configured Project for duplicates. Discover labels,
   milestones, assignees and workflow options; reuse them. Keep one accountable
   owner without transferring ownership unless requested.
2. Give each issue one independently verifiable outcome that fits one PR. Include
   integration explicitly. Group delivery slices with repository milestones and
   decomposition with parent/sub-issues (or an explicit task list when unavailable).
   Link real prerequisites as native blocking relations where supported. Ordering
   alone does not establish a dependency.
3. Map requirements to every affected route, state and viewport in
   `docs/mockups/INDEX.md`. Select each row's actual PNG; label mockups as designs
   and current screenshots as current behaviour. Backend-only issues explain why
   screens do not apply. Missing decisions or images keep an issue unready.
4. Draft the template below. Acceptance names a trigger, observable result and
   verification method; cover affected failure and empty paths. Implementation
   hints remain subordinate to the outcome. Read [splitting work](references/splitting.md)
   for milestones, parent issues and an example.
5. Publish the settled body, labels and milestone. Add the issue to its Project,
   set the discovered planning Status, Priority and Order fields, and verify them.
   For Issues-only work use configured workflow/priority labels and explicit order
   in the implementation plan; a Project is optional.
   Attach all PNGs with `attaching-screens-to-tickets`; inspect saved images and
   reconcile row IDs back into INDEX. Preserve unrelated issue text on refresh.
6. Read back bodies, images, fields and dependencies. Every requirement needs work;
   every UI row needs an owning issue; every UI issue needs all its rows. Only
   recommend Todo/intake once questions are resolved, images verified and all
   blockers complete. Apply the configured intake label only to ready work.

## Template

```markdown
## Outcome
<One user capability or corrected behaviour; REQ IDs.>

## Why
<Problem, affected user and links to requirements/specs.>

## Screens
<Captioned image for every route/state/viewport, or a backend-only rationale.>

## Acceptance criteria
- [ ] <Trigger, observable result and how to verify it.>

## Out of scope
<Adjacent work excluded from this PR.>

## Depends on
<Full prerequisite issue links and completion conditions, or None.>
```

Put dependency links in the body even with native relations so a reader can see
what must land first. A Markdown checklist alone does not gate Kor intake. Keep
milestone and Project Status separate: milestones group releases, Status tracks
workflow. Ready counts exclude parent tracking issues unless they have their own
buildable outcome. Report full issue URLs, requirement/screen coverage and each
specific unresolved blocker. Local ticket plans are not published issues.
