---
name: blast-radius
description: "Finds downstream breakage. Use when assessing what a change could break beyond its diff."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "execute,repair,review"
  kor.triggers: "assessing what a change could break beyond its diff"
  kor.anti: "architecture explanation without an evaluated change"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/blast-radius/SKILL.md"
---

# Check the blast radius

Read the diff and identify the one or two facts its safety depends on.
Trace beyond direct callers: serialized values, database columns, flags, foreign-language consumers, teardown order, and pinned dependency behavior.
Read the actual dependency source at the installed version. Distinguish a cited line from a demonstrated runtime fact.
Run the real function or user flow that would disprove the safety claim. Use an existing check or a small permitted proof command.
Report the changed behavior, each confirmed risk with its source and consequence, and risks cleared by observed evidence.
Mark any safety fact you could not exercise as unproven. Follow the repository's test policy and keep private data out of the report.
