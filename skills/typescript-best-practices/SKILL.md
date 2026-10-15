---
name: typescript-best-practices
description: "Reviews TypeScript types. Use when reading or editing TypeScript source."
license: MIT
metadata:
  kor.kind: "skill"
  kor.stages: "execute,repair,review"
  kor.triggers: "reading or editing TypeScript source"
  kor.anti: "language-independent interface design without TypeScript source"
  kor.visibility: "public"
  kor.budget: "2000"
  kor.source: "https://github.com/cursor/plugins"
  kor.commit: "e5136d82418d2db3165ea1050d17577cd618cc05"
  kor.upstream: "pstack/skills/typescript-best-practices/SKILL.md"
---

# TypeScript best practices

Parse external data from `unknown` using the repository's runtime schema library and derive the type from that schema.
Use discriminated unions for variants, `satisfies` for checked literals, and exhaustive switches with `never`.
Keep arrays plain while their operations are total. Require a non-empty shape only where an operation needs one.
Use distinct types for semantically different identifiers. Prefer narrowing to `any`, casts, or non-null assertions.
Derive types with `Pick`, `Omit`, `Parameters`, `ReturnType`, and `Awaited` before duplicating an authoritative shape.
Use object arguments where they make calls clearer. Match the surrounding code on hot paths.
Keep parsed domain data inside the boundary and structured diagnostics at the shell.
Run the existing compiler and permitted checks against both ordinary and invalid inputs. Follow the repository's test policy.
