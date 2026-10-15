---
name: investigate
description: "Produces a cited investigation. Use when a task asks for a read-only answer or comparison."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "a task asks for a read-only answer or comparison"
  kor.anti: "implementing a fix, feature, or structural change"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/poteto-mode/playbooks/investigation.md"
---

# Investigate

1. State the question and what the answer must decide. Gather code, logs, history, and primary documentation read-only.
2. Compare competing explanations against observed evidence. Preserve contradictions and redact private data.
3. Write a standalone report with source pointers, findings, limits, and a recommendation. State what should ship separately.
4. Put unresolved decisions and options in one place. Finish with the report path and supported conclusion.
