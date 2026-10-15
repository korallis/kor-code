---
name: prototype
description: "Explores a design decision. Use when a throwaway artifact can resolve an empirical design fork."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "a throwaway artifact can resolve an empirical design fork"
  kor.anti: "a settled design or production implementation"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/poteto-mode/playbooks/prototype.md"
---

# Prototype

1. Name the decision and the observation that would distinguish alternatives. If no decision is uncertain, proceed with the scoped implementation instead.
2. Build the smallest throwaway artifact in isolated scratch space. Use labeled variants or a switcher when comparing designs.
3. Drive each variant on its actual surface. Capture interactions and screenshots for visual work, outputs or timings for behavioral work.
4. Compare evidence, recommend a direction, and state the tradeoffs. Hand the chosen direction and scratch path back for the production implementation.
Keep the prototype out of production source. Respect existing permission and data boundaries.
