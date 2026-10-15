---
name: sketch-types
description: "Sketches interfaces before logic. Use when a change introduces a module or crosses a function boundary."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "a change introduces a module or crosses a function boundary"
  kor.anti: "mechanical edits within an established interface"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/architect/SKILL.md"
---

# Sketch types

1. Read the relevant ownership boundaries and constraints. Write the caller's intended usage first.
2. Derive types, signatures, and module responsibilities from that usage. Compare distinct shapes when the interface decision is uncertain.
3. Prefer an interface that hides meaningful complexity and makes invalid states hard to express. Record the chosen shape and reasons.
4. Fill in implementation against the sketch within the task's scope. Treat repeated workarounds as evidence that the sketch is wrong.
5. Revisit the sketch when multiple independent deviations share a cause. Verify the actual callers and report the final interface and unresolved constraints.
