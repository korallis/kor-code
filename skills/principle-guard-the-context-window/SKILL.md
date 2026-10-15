---
name: principle-guard-the-context-window
description: "Limits context growth. Use when large outputs, long files, or repeated reads obscure the task."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review"
  kor.triggers: "large outputs, long files, or repeated reads obscure the task"
  kor.anti: "a short targeted read already within scope"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/principle-guard-the-context-window/SKILL.md"
---

# Keep context bounded

Size each phase around the question it must answer. Search and count first, then read bounded ranges or summaries. Save bulk output as an artifact instead of pasting it into the conversation.

Keep concise findings with file and line pointers so later work can return to the evidence. Reuse those findings before reading the same material again. Work within the session's available capabilities and avoid expanding the task to process irrelevant data.
