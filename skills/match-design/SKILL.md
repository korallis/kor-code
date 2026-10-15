---
name: match-design
description: "Matches a visual baseline. Use when migrating or implementing a screen against an approved design."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "migrating or implementing a screen against an approved design"
  kor.anti: "open-ended visual design without an approved baseline"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/poteto-mode/playbooks/visual-parity.md"
---

# Match design

1. Capture or obtain the approved baseline and required states before changing the screen. Record viewport, fonts, data, and capture conditions.
2. Keep the baseline and comparison settings fixed. If the target is ambiguous or wrong, report the discrepancy for a decision.
3. Change one component at a time, shared primitives before their consumers. Drive the real screen and compare captures under matching conditions.
4. Inspect image differences and verify interactions. Use the approved tolerance, or establish one before claiming equivalence. Avoid hiding real differences with masks or changing the baseline.
5. Report each state compared, the measured delta, screenshots, and any unmatched or unverified condition.
