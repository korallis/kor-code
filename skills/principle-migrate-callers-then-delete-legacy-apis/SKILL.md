---
name: principle-migrate-callers-then-delete-legacy-apis
description: "Removes obsolete internal APIs. Use when a coordinated API migration can update every internal caller."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review"
  kor.triggers: "a coordinated API migration can update every internal caller"
  kor.anti: "external compatibility contracts requiring a deprecation window"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md"
---

# Migrate Callers Then Delete Legacy APIs

When we decide a new API is the right design, migrate callers and remove the old API in the same refactor wave instead of preserving compatibility layers.

**Rule:**
- Do not keep legacy API paths only because internal callers still exist
- Inventory callers, migrate them, and delete the old API immediately
- Treat temporary adapters as exceptional and time-boxed, not default architecture
- Run existing checks against the new contract and follow the repository's test policy

**When this applies:**
- No external users depend on backward compatibility
- The project can absorb coordinated breaking changes
- The new API is part of a simplification or refactor initiative

Keeping both old and new APIs creates dual-path complexity, slows cleanup, and makes the codebase feel append-only.

Follow the repository's scope, permission, and test policy when applying this principle.
