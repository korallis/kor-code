---
name: principle-encode-lessons-in-structure
description: "Enforces recurring lessons. Use when an instruction or correction has repeated."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review"
  kor.triggers: "an instruction or correction has repeated"
  kor.anti: "a one-off transformation without a recurring failure"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/principle-encode-lessons-in-structure/SKILL.md"
---

# Encode lessons in structure

When an instruction or correction repeats, make the wrong action fail through architecture, types, a lint, metadata, or a runtime check. Prove the enforcement rejects a real past mistake.

If the lesson requires judgment and cannot be encoded, make the instruction clear and show the failure mode. Use a structural fix alone when it removes the need for another instruction. Follow the repository's scope and test policy.
