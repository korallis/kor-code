---
name: principle-attack-the-premise
description: "Questions shared assumptions. Use when two failed fixes rely on the same premise."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review"
  kor.triggers: "two failed fixes rely on the same premise"
  kor.anti: "first diagnosis before any failed experiment"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/principle-attack-the-premise/SKILL.md"
---

# Attack the Premise

When two or more fixes that share one premise have failed the same gate, suspect the premise, not the fixes.

**Why:** Each failed fix is evidence against the belief it assumed. A third fix on the same premise spends effort where the evidence already says the cause is not.

**Pattern:**
- **Write the premise down.** The premise is the one sentence that every failed fix assumed.
- **Test the premise before the next fix.** Find an observation that would come out differently if the premise were false, and make it. Look at how the failures are distributed, not only at how large they are. Make the check rerunnable per `principle-build-the-lever`.
- **Follow the evidence.** If it contradicts the premise, the cause is elsewhere. Look for what the failures have in common that the premise did not predict. If it confirms the premise, ask the next "why" per `principle-fix-root-causes`. The earlier fixes may have treated a consequence instead of the cause.
- **Remove the condition instead of compensating for it**, per the `principle-laziness-protocol`. If the evidence shows that one part always lands on the losing side, change what puts it there. A mechanism that cleans up after it leaves the cause in place and adds work on every run.

**Stop:** Do not start the next fix before the premise is written down and tested.

This principle is distinct from `principle-redesign-from-first-principles`, which rebuilds a design around a new requirement. It questions a fact the current design assumes.

Follow the repository's scope, permission, and test policy when applying this principle.
