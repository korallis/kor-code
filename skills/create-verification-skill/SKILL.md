---
name: create-verification-skill
description: "Creates verification guidance. Use when a project lacks a repeatable way to drive its real user surface."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "plan,execute,repair,review,project-setup"
  kor.triggers: "a project lacks a repeatable way to drive its real user surface"
  kor.anti: "auditing an existing verification bundle"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/create-verification-skill/SKILL.md"
---

# Create a verification skill

Inspect the repository to identify its user surface, documented launch command, required data, authentication, existing driving tools, observable effects, and isolation constraints.
Start the real app before documenting it. Record a startup blocker instead of inventing instructions for a broken base.
Create `skills/verify-<app>/SKILL.md` in the repository's Kor public tier, or its explicitly configured private tier for sensitive guidance. Include a valid name, trigger description, and license.
Write grounded launch, doctor, drive, evidence, and cleanup steps. Doctor must establish that the instance is yours and usable.
Put a feature index and feature recipes under the bundle's `references/`. Link every Markdown reference directly from SKILL.md. Describe each feature's prerequisites, user entry point, drive steps, expected state, and gotchas.
Use existing controls to exercise real user paths and side effects. Keep evidence outside cleanup targets. Stop only processes the proof started.
Run the generated instructions end to end on one mapped feature. Verify that cleanup preserves the evidence. Lint the generated bundle and report any unverified surface. Follow the repository's test policy.
