---
name: change-docs
description: "Updates documentation against evidence. Use when the deliverable changes prose or examples without product behavior."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "the deliverable changes prose or examples without product behavior"
  kor.anti: "code changes that alter product behavior"
  kor.visibility: "public"
  kor.budget: "1500"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/technical-writing/SKILL.md"
---

# Change docs

1. Identify the reader's task and the authoritative behavior. Read the actual commands, source, or versioned documentation.
2. Choose tutorial, how-to, reference, or explanation. Make the scoped edit using `technical-writing` and preserve unrelated wording.
3. Run documented commands when safe, verify paths and links, and compare examples with real output. Record any command that could not be exercised.
4. Read the diff for stale duplicates and filler. Finish with the changed guidance, evidence, and limits. Hand publication to the configured shipping stage.
