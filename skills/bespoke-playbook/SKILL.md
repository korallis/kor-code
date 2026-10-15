---
name: bespoke-playbook
description: "Designs a bounded workflow. Use when a large migration or unusual task fits no narrower procedure."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "a large migration or unusual task fits no narrower procedure"
  kor.anti: "a bounded task that fits a narrower session procedure"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/figure-it-out/SKILL.md"
---

# Bespoke playbook

1. Define done as a falsifiable predicate. Record scope, authorized changes, risks, and the evidence needed to decide success.
2. Write a phase list ordered by the riskiest unknowns. Capture a baseline and establish the verification command before implementation.
3. For each unit, state a hypothesis, make the smallest change, and measure the real artifact. Keep useful changes and revert refuted experiments.
4. Record decisions and evidence as work proceeds. Use VERIFIED, NOT VERIFIED, or INCONCLUSIVE. An inconclusive result remains open.
5. Verify the whole against the original predicate and summarize open calls. Respect explicit approval gates for irreversible work and hand shipping to Kor.
