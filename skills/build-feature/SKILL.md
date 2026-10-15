---
name: build-feature
description: "Builds scoped behavior. Use when implementing a new feature with defined acceptance criteria."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "implementing a new feature with defined acceptance criteria"
  kor.anti: "fixing a regression or preserving all existing behavior"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/poteto-mode/playbooks/feature.md"
---

# Build feature

1. Read the affected subsystem and acceptance criteria. Name the user outcome and the data shape before writing logic.
2. Sketch caller usage and interfaces for boundary changes. Identify prerequisites and shared state before implementation.
3. Build in small units that each produce a checkable result. Match the repository's code and test policy.
4. Verify every acceptance criterion through the actual UI, CLI, or service surface and run relevant existing checks.
5. Update user documentation for changed behavior. Hand the diff and observed evidence to Kor's verification and shipping stages.
