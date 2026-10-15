---
name: refactor
description: "Restructures code with stable behavior. Use when renaming, moving, or simplifying implementation."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "renaming, moving, or simplifying implementation"
  kor.anti: "new behavior or a bug fix"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/poteto-mode/playbooks/refactoring.md"
---

# Refactor

1. Capture the behavior contract before edits: visible text, defaults, persisted keys, exports, wire shapes, and errors. Record actual baseline outputs or screenshots.
2. Name the target shape. Remove dead code and one-caller wrappers before adding structure.
3. Move in small steps and compare against the baseline after each. Migrate internal callers before removing old paths. Preserve external compatibility where required.
4. Separate discovered bugs or missing features into other work. Run existing checks under the repository's test policy.
5. Compare the real artifact with the baseline. Report equivalence evidence, reduced reader load, and any unverified path.
