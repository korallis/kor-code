---
name: technical-writing
description: "Writes technical documentation. Use when editing guides, references, RFCs, or README files."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "execute,repair,review"
  kor.triggers: "editing guides, references, RFCs, or README files"
  kor.anti: "product behavior changes or prose-only filler cleanup"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/technical-writing/SKILL.md"
---

# Write technical documentation

Choose the document's purpose: tutorial for learning by doing, how-to for completing work, reference for lookup, or explanation for understanding.
Keep one purpose per document and link to the others when needed.
Use the codebase's real symbols and commands. State who does what, put conditions before instructions, and use one action per sentence.
Make pronouns unambiguous, keep terminology stable, and use familiar words. Cut words that add no meaning.
For procedures, state prerequisites and the observable result. For reference, describe options and errors without tutorial steps.
Use descriptive links, sentence case headings, and numbered lists for sequences. Keep code examples copyable.
Check commands, paths, counts, and examples against the actual artifact. Follow the repository's PR template for PR descriptions.
Edit filler using `unslop` before delivery.
