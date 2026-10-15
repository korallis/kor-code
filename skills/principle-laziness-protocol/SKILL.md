---
name: principle-laziness-protocol
description: "Minimizes implementation scope. Use when a change adds speculative layers or repeats a decision."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review"
  kor.triggers: "a change adds speculative layers or repeats a decision"
  kor.anti: "a product tradeoff that requires changing the requested outcome"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/principle-laziness-protocol/SKILL.md"
---

# Laziness Protocol

- **Consolidate decisions.** Do not repeat the same choice in several places. Put it behind one source of truth and pass the result as a simple flag.
- **Minimize the diff.** Make the smallest change that solves the problem. Fewer lines beat "elegant" boilerplate.

Follow the repository's scope, permission, and test policy when applying this principle.
