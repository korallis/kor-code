---
name: human-written-code
description: Reviews code for needless machinery and filler. Use when writing, editing or reviewing code, or cleaning up a diff.
license: MIT
metadata:
  kor.kind: standard
  kor.stages: execute,repair,review
  kor.triggers: write code; edit code; review diff; clean up comments
  kor.anti: writing prose or pull request descriptions
  kor.visibility: public
  kor.budget: "1000"
---

# Human-written code

Read the neighbouring code and the repository's contribution and style guidance.
Match its naming, layout, imports and error handling. Repository policy decides
which checks and tests to run.

## While editing

- Make the smallest change that solves the task. Remove code your change makes
  unused; keep unrelated behaviour, wording and stored data unchanged.
- Reuse an existing helper or component before adding one. Introduce abstractions
  when concrete callers need them, with names that explain their job.
- Use small, plain names. Prefer early returns when they make the logic easier to
  follow. Name meaningful sizes, timings and limits as constants.
- Keep comments for reasons the code cannot express: a constraint, a surprising
  compatibility requirement or the origin of a constant. Delete narration,
  section banners and commented-out code.
- Validate external inputs at their boundary. Trust the resulting types inside
  the system. Add error handling for actual failure cases; remove checks and
  fallbacks for states the caller already rules out.
- Leave no debugging output, unused imports or exploratory files in the diff.

## Before committing

Read the diff as a maintainer. For a cleanup or a review, scan
[slop patterns](references/slop-patterns.md) for concrete examples. Run the
repository's required checks and follow its test policy. Finish when each
remaining line has a purpose and the checks support the claimed behaviour.
