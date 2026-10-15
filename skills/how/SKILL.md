---
name: how
description: "Explains code architecture. Use when answering how a subsystem works or where behavior belongs."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review,project-setup"
  kor.triggers: "answering how a subsystem works or where behavior belongs"
  kor.anti: "motivation without runtime or ownership questions"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/how/SKILL.md"
---

# Explain how a subsystem works

Bound the question to the named behavior or ownership decision. Follow the entry point through its actual callers, state, boundaries, and side effects.
For a small module, inspect it directly. For a broad subsystem, divide the reading into distinct questions and keep concise source pointers.
Explain the key concepts before the runtime flow, then map responsibilities to files. Include constraints and surprising failure paths that affect the requested change.
Cite actual source locations. Distinguish observed runtime behavior from source inference, and mark anything not verified.
Use Overview, Key concepts, How it works, Where things live, and Gotchas only where helpful. For a placement question, state the owning module and the invariant that makes it the right boundary.
A read-only explanation ends with the answer, evidence, and any proposed follow-up, without implementing it.
