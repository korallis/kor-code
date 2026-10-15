---
name: correct
description: "Prevents repeated mistakes. Use when the same correction occurs twice in a repository."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "execute,repair,review"
  kor.triggers: "the same correction occurs twice in a repository"
  kor.anti: "a single correction without evidence of recurrence"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/correct/SKILL.md"
---

# Correct repeated mistakes

Read the relevant commits, reverts, and review comments. Group mistakes by cause and require two actual occurrences before calling a pattern repeated.
Try architecture first: give state one owner, generate repeated lists from one source, and remove obsolete examples that invite the mistake.
Then try types that reject the bad state. If the mistake still compiles, add a narrow lint or runtime check whose error names the supported replacement.
Replay a real past mistake against the check and prove it fails. Prove valid behavior still passes with the repository's existing checks.
Use documentation only for decisions that require judgment. Keep any rule-to-enforcement table in project documentation, not automatically in agent instruction files.
Follow the repository's test policy. Report the mistake evidence, the structural fix, and the failing-then-passing proof.
