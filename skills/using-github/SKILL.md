---
name: using-github
description: Reads and updates GitHub tracker records. Use when managing GitHub Issues, Projects v2 or ticket progress.
license: MIT
metadata:
  kor.kind: skill
  kor.trackers: github
  kor.stages: plan,execute,repair,review,ship,project-setup
  kor.triggers: read GitHub issue; update GitHub project; report ticket progress; upload issue image
  kor.anti: drafting or splitting ticket content; pull request shipping; Linear projects
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "1300"
---

# Using GitHub Issues and Projects

Resolve the repository's configured tracker first. A GitHub repository used for
pull requests can still use Linear for planning. Use this skill for GitHub-tracker
projects; preserve the configured owner, repository, Project v2 and workflow.

1. Read the issue by full URL or `OWNER/REPO#NUMBER`; numbers alone are ambiguous
   across repositories. Read its body, all comments, labels, assignee, milestone,
   parent/sub-issues, blocking relations and Project item fields. Paginate every
   connection/list; search the repository and Project for existing work.
2. Discover actual labels, milestones and Project fields/options before writing.
   Project number, Project node ID, issue node ID and Project item ID are different
   values. A Project can include several repositories. Verify each identity.
   Use `gh-axi` for GitHub operations; read `--help` for installed commands.
   For setup or field operations read [Projects v2](references/projects.md).
3. Keep scope/acceptance in the issue body, progress/evidence/decisions in comments,
   and shared context in versioned `docs/` linked from the Project README and issues.
   Preserve unrelated text and existing ownership. Use `writing-github-tickets`
   for new or split work. Use repository milestones for delivery slices; sub-issues
   express decomposition and blocking relations express prerequisites.
4. Write dependent changes in order using returned IDs. After a timeout, read
   before retrying creates. Search exact titles and links to resume a partial setup.
   Kor owns its execution-state transitions and progress comments; add missing
   evidence without duplicating them. Never post credentials or runtime config.
5. Read back every changed issue, Project item/field, milestone and relation.
   For UI work use `attaching-screens-to-tickets`: every affected inventory row
   needs an inspected image in the issue body. Report full links, observed changes
   and exact gaps. API success alone is insufficient.

## Readiness and state

GitHub issue state is open/closed; the Project's single-select **Status** field
represents planning, Todo, In Progress, review and completion. Use the configured
mapping and discovered option IDs. An open issue may be in review; closing an
issue does not establish that a PR merged. Honour Kor's shipping policy and let
Kor own the final execution/completion transition.

Only opt an issue into intake when acceptance questions are settled, blocking work
is complete and every applicable screen image is verified. A task list is a
visible checklist, not an enforced dependency. If native blocking is unavailable,
record explicit `Depends on` links, keep blocked work out of Todo/intake and report
that manual enforcement is required. Never claim a relation was created without
readback. Without access, save the proposed changes locally and name publication
as blocked; do not claim published records.

Without a Project, use the configured workflow/priority labels and open/closed
mapping. Preserve unrelated labels and replace only superseded workflow labels.
Keep explicit order and prerequisite links in the issue/implementation plan.
Do not create a board or invent a `kor github` command to fill a gap.
