# Public skills

Kor's public guidance lives in `skills/<name>/SKILL.md`, licensed under the
repository's MIT license unless a skill declares another license. The first two
standards cover code style (`human-written-code`) and pull requests (`pr-standard`).
They adapt the owner's code and PR conventions, with repository policy taking
precedence. Shipping this tier does not yet load it into execution sessions;
catalogue selection and delivery are separate work.

The direct shipping path also enforces the PR layout in code, without loading a
skill into the session. It uses the five sections from `pr-standard`, maps
recorded checks and acceptance findings into the body, and respects a committed
repository template. [Shipping templates](specs/shipping.md#pull-request-format)
describe the title fallback, template placeholders, and publication limits.
`human-written-code` remains guidance for editing and review; it does not change
the repository's test policy.

Run the built CLI from any directory, without credentials or a daemon:

```sh
kor skills lint
kor skills lint ./my-skills --json
```

From a source checkout, use `bin/kor` after `pnpm install --frozen-lockfile` and
`pnpm build`. With no directory argument, lint checks the `skills/` next to Kor's
packages, even when your working directory is elsewhere. An explicit directory
is relative to your working directory and contains one directory per skill.
Lint reads files only. Keep private guidance outside the public checkout.

## Format

Use YAML frontmatter followed by a Markdown body:

```yaml
---
name: reviewing-changes
description: Reviews changes for acceptance gaps. Use when reviewing a completed implementation.
license: MIT
metadata:
  kor.kind: standard
  kor.stages: review,ship
  kor.triggers: review changes; prepare pull request
  kor.anti: implementing new features
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "1000"
---
```

| Field | Contract |
| --- | --- |
| `name` | Required, 1–64 lowercase letters, digits and single hyphens; matches the directory; starts and ends with a letter or digit. |
| `description` | Required, 1–1,024 characters after trimming; starts with a third-person action (`Writes`, `Reviews`, `Checks`); includes `Use when`, `Use whenever` or `Use for`. State the concrete work and trigger. |
| `license` | Required, nonempty license identifier or bundled license reference. Review the actual license before importing third-party content. |
| `compatibility` | Optional, at most 500 characters describing environment requirements. |
| `allowed-tools` | Optional string of tool permissions. Repository permissions remain authoritative. |
| `disable-model-invocation`, `user-invocable` | Optional booleans for compatible skill consumers. |
| `metadata` | Optional flat map of strings; quote numbers. Namespaced `kor.*` keys below describe the skill. |

Unknown top-level fields fail schema validation. `kor.kind` is `skill`, `standard`
or `playbook`. `kor.stages` is a comma-separated list drawn from `plan`, `execute`,
`repair`, `review`, `ship`, `project-setup`. Public tier `kor.visibility` can only
be `public`. `kor.budget` is a positive integer string; the default is 2,000 body
tokens. `kor.triggers`, `kor.anti` and `kor.requires` are selection hints, not
permissions. Additional metadata remains a string map for future consumers.

## Lint rules

Errors fail the command:

- Invalid YAML (including duplicate keys and aliases), missing fields, invalid
  metadata values, invalid name or directory mismatch, missing or empty body.
- Descriptions without a third-person action or an explicit use trigger. These
  are syntax checks; a reviewer checks specificity and whether the trigger fits.
- Bodies over 500 lines. Markdown references must be linked directly from
  `SKILL.md`: a reference linking to another Markdown file is a nested reference.
  Markdown inline links, reference-link definitions and backticked paths under
  `references/`, `scripts/` and `assets/` are checked. Local targets must exist
  within the same skill. Symlinks are rejected throughout the bundle.
- Reference Markdown over 100 lines without a `Contents` or `Table of contents`
  heading. A reviewer checks that its entries actually cover the document.
- Backslash paths. Write portable forward-slash paths.
- Overlapping descriptions without `kor.anti`. The deterministic overlap check
  counts at least three shared words of three or more letters, excluding common
  description boilerplate. Review neighbouring skills even when this check passes.
- Routing content, as described below.

Warnings identify a trigger after the first 120 description characters, estimated
body cost above `kor.budget`, uppercase MUST/NEVER/REQUIRED/ALWAYS rules after body
line 150, date patterns and time-sensitive wording, and noncanonical spellings
(`JEV`/`jev`, `play-book`, `skillset`). Canonical terms are **Jev**, **playbook**
and **skill pack**. Warnings do not change the exit code.

### Routing belongs to Jev

Skills and playbooks describe how to do work. The per-task Jev route decision
owns model, provider, harness and reasoning settings. Lint rejects routing fields
at any frontmatter depth, including `model`, `effort`, `agent`, `provider`,
`harness` and reasoning-level variants. Frontmatter text and bundled Markdown,
text, scripts, JSON and YAML are also scanned for model slugs, model tiers,
reasoning settings, routing flags and common model/provider/harness instructions.
An ordinary code fence does not exempt routing text.

A necessary quotation of an upstream source must be fenced with an explicit
`upstream-quote` label followed by an HTTPS source URL. Only that closed quotation
is exempt from the text scan; frontmatter fields are never exempt. Keep quotations
as evidence, never executable instructions. Reviewers must reject routing advice
that a lexical scan cannot recognise, including provider or harness suggestions
worded indirectly. Lint is a guardrail, not a semantic proof or a privacy audit.

## Output and proof

Text output lists file, line, severity and rule, then per-skill listing and body
costs. `--json` returns `schemaVersion: 1`, `ok`, `root`, `tokenMethod`, `skills`
and `diagnostics`. Each diagnostic has `file`, `line`, `severity`, `rule` and
`message`. Exit `0` means no errors (warnings may remain); `1` means lint or I/O
failure; `2` means invalid arguments. I/O failures use the shared CLI error shape.

Token counts are explicitly **estimates**: `ceil(characters / 3.7)`, separately
for `name: description` and the body. Manual-only skills have zero listing cost.
These are not tokenizer measurements or a promise about harness overhead.

```sh
node scripts/skills-lint-proof.mjs
```

The proof invokes the real built CLI on the seeds and temporary planted-bad
bundles, including each lint diagnostic, routing in references and scripts, the
quotation exception and usage errors. It writes no fixture into the public tier.
CI runs public lint and the proof after building Kor.

Before adding a skill, review these judgment checks alongside lint:

- Lead with vital instructions; disclose branch-specific material in direct references.
- State whether a bundled script should be executed or read; audit its behaviour
  and tool requirements. Prefer scripts for deterministic steps and prose for judgment.
- Give workflows observable completion criteria and a validation loop. Plan and
  validate before risky execution. Put invariants in code or hooks where possible.
- Keep one default approach and a clear condition for taking an alternative.
- Confirm public-safe content, source attribution and license rights. Third-party
  imports need a pinned source and content hash through the import workflow.
- Prepare at least three representative scenarios, compare outcomes with guidance
  hidden and offered, and record gaps. This lint proof checks authoring rules; it
  does not establish that either seed improves execution outcomes.
