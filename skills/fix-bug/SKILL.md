---
name: fix-bug
description: "Fixes reported behavior. Use when a task requires a bug fix or regression repair."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "a task requires a bug fix or regression repair"
  kor.anti: "diagnosis-only requests or behavior-preserving cleanup"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/poteto-mode/playbooks/bug-fix.md"
---

# Fix bug

1. State expected and observed behavior. Use `diagnose-bug` to reproduce on the real user surface and locate the causal fault.
2. Plan the smallest fix justified by that evidence. Sketch changed interfaces before implementation when a boundary moves.
3. Fix the cause and remove changes motivated by refuted hypotheses. Follow `human-written-code` and the repository's test policy.
4. Repeat the original reproduction on the same surface and run the relevant existing checks. Wrong-surface or inconclusive evidence is not a pass.
5. Hand the verified diff, cause, before/after observations, and remaining limitations to Kor's verification and shipping stages.
