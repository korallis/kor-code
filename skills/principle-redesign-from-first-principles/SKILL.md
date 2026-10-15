---
name: principle-redesign-from-first-principles
description: "Revisits design assumptions. Use when a new requirement changes the foundations of an existing design."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review"
  kor.triggers: "a new requirement changes the foundations of an existing design"
  kor.anti: "questioning a factual premise after repeated failed fixes"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/principle-redesign-from-first-principles/SKILL.md"
---

# Redesign From First Principles

When integrating a change, don't bolt it onto the existing design. Redesign as if the requirement had been a foundational assumption from the start.

- Read all affected files and understand the current design
- Ask: "if we were writing this from scratch with this new requirement, what would we build?"
- Propagate the change through every reference: types, docs, examples, rationale sections
- Think about the whole redesign, then deliver it incrementally

This is the method for preserving option value when integrating changes into an existing design.

Follow the repository's scope, permission, and test policy when applying this principle.
