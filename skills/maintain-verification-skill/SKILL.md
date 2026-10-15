---
name: maintain-verification-skill
description: "Audits verification guidance. Use when checking an existing verification skill and feature map for drift."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review,project-setup"
  kor.triggers: "checking an existing verification skill and feature map for drift"
  kor.anti: "creating a first verification bundle or fixing product code"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/maintain-verification-skill/SKILL.md"
---

# Maintain a verification skill

Locate the requested verification bundle in the repository's Kor tier. If several match and the request does not distinguish them, report the ambiguity. If none exists, report that prerequisite.
Limit edits to that bundle's guidance, feature references, and owned helpers. Product regressions become separate findings.
Compare the feature index with its files and the source. Record a concise live recipe for each feature and inspect recent changes for missing entry points.
Drive every mapped feature against the real app. Health-check before the first drive and after any surprising failure. Reset only the instance you own when its state is uncertain.
Preserve all evidence during cleanup and stop only processes created by this run. Classify each mismatch as documentation drift, a driving-tool gap, or a product regression.
Re-drive any corrected helper. Lint the bundle and report clean, changed, or blocked with feature coverage and concrete limitations. Do not mark missing prerequisites as a pass.
