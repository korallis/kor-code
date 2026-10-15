# Public skills

Kor's public guidance lives in `skills/<name>/SKILL.md`, licensed under the
repository's MIT license unless a skill declares another license. The bundled
standards cover code style (`human-written-code`) and pull requests (`pr-standard`).
The `using-linear` skill covers tracker operations and image handling;
`writing-linear-tickets` covers scope, acceptance, dependencies and screen evidence.
The standards adapt the owner's code and PR conventions, with repository policy taking
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
- Routing content, as described below.

Warnings identify a trigger after the first 120 description characters, estimated
body cost above `kor.budget`, uppercase MUST/NEVER/REQUIRED/ALWAYS rules after body
line 150, date patterns and time-sensitive wording, and noncanonical spellings
(`JEV`/`jev`, `play-book`, `skillset`). Canonical terms are **Jev**, **playbook**
and **skill pack**. Warnings do not change the exit code.

`overlap-anti` is also a warning: descriptions sharing at least three words of
three or more letters (excluding common description boilerplate) suggest adding
`kor.anti`. Shared vocabulary alone does not establish overlapping use cases;
review neighbouring skills even when this check passes.

### Routing belongs to Jev

Skills and playbooks describe how to do work. The per-task Jev route decision
owns model, provider, harness and reasoning settings. Lint rejects routing fields
at any frontmatter depth, including `model`, `effort`, `agent`, `provider`,
`harness` and reasoning-level variants. Frontmatter text and every bundled text
file are scanned, including extensionless scripts, dotfiles and unfamiliar
extensions. Files containing NUL bytes are treated as binary and skipped; the
required `SKILL.md` is always scanned. Text is decoded as UTF-8.

The text scan rejects model slugs, routing flags, routing assignments, explicit
instructions naming a model tier or harness, provider selection instructions,
and instructions setting an effort level. This includes tiers after routing
prepositions (`on`, `with`, `using`, `via`, `under`), provider choices followed by
`for` or `over`, and the routing-specific `xhigh` token. Ordinary mentions of
effort or a domain model are allowed, as are statements that leave routing to Jev.
For example, "Use the domain model to name things" and "Make minimal effort to cut
scope" pass. A provider's style guide is also ordinary prose. An ordinary code
fence does not exempt routing text.

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
bundles, including each lint diagnostic, routing in references and scripts of
varied extensions, ordinary prose, binary assets, the quotation exception and
usage errors. It writes no fixture into the public tier.
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

## Catalogue

Build and inspect the merged catalogue without starting the daemon:

```sh
kor skills index
kor skills list --json
kor skills show human-written-code
kor skills doctor --estimate
kor skills doctor --from ./existing-skills --from ./another-pack --json
```

`index` writes `XDG_STATE_HOME/kor/skills/catalogue.json` (default
`~/.local/state/kor/skills/catalogue.json`) only when there are no errors. The
write is atomic, with a `0700` directory and a `0600` file. A failed index keeps
the previous catalogue. `list`, `show` and `doctor` rebuild a read-only view of the
current sources, so they detect changes without replacing that file. `show NAME`
prints one row's metadata, origins, costs and catalogue hash; an ambiguous name
fails. These commands do not select skills or deliver them to sessions.

By default the sources are Kor's bundled public `skills/`, the optional private
`XDG_CONFIG_HOME/kor/skills/` directory, and configured packs. No harness skill
folder is searched automatically. Repeat `--from DIRECTORY` to **replace** these
sources with an explicit read-only scan. A source may be a skill directory, a
`SKILL.md` file, or a parent containing skills. Discovery follows directory links,
resolves physical paths once per source and stops at each skill bundle. It skips
`.git` and `node_modules`. Symlinks inside a bundle fail indexing. Sources are
never copied, edited or executed.

Configure sources and soft warning budgets in Kor's `config.yaml`:

```yaml
skills:
  privatePath: ~/private-guidance
  packs:
    - ~/skill-packs/frontend
  jev: names-only
  listingBudget: 8000
  bodyBudget: 2000
```

Paths support `~` and resolve relative to `config.yaml`. `privatePath` replaces
the default private directory; a missing explicit source is an error. `jev`
defaults to `names-only` for private guidance; `full` permits its description and
selection hints in the catalogue. `metadata.kor.visibility: local-only` always
reduces the row to its name and a fixed summary label, with triggers and
anti-triggers omitted. Explicit `--from` scans also use that restricted view.
Origins, tool requirements and hashes remain local catalogue facts; consumers
must respect `jevVisible` when constructing selection requests.

Identical bundles merge into one row with every origin retained. The SHA-256
content hash covers every bundled file, using sorted relative filenames and
byte hashes, so changing a reference, script or asset changes the skill hash.
Repeated paths to the same physical file are counted once. Different content
with the same name is an error, including within one tier. The sole exception
is a private skill declaring `metadata.kor.overrides: public`: it replaces a
public skill of that name, with a warning. The public tier uses the full lint
rules above. External sources accept existing non-Kor metadata and missing
licenses for inventory purposes, while validating names, descriptions and Kor
metadata. Inventory success is not permission to execute a bundle; delivery
must still enforce authoring, routing and repository policy.

Costs cover `name: description` (zero for manual-only skills), the body, and the
sum of text files under `references/`. `referencesMaxTokens` represents loading
all those reference texts, excluding binary assets and executable scripts.
Without credentials, with `--estimate`, or after a counting failure, costs use
`ceil(characters / 3.7)`. Otherwise the command calls the gateway's
`/v1/messages/count_tokens`, using the existing configured route as tokenizer
context. It never chooses or changes a route. Each request times out after two
seconds; a failure switches remaining rows to estimates. Each row labels its
method. Gateway counts include the endpoint's message framing, so they are a
conservative cost, not an exact harness prompt delta. Private `names-only`,
`local-only` and `--from` text always stays local and uses estimates. Full-visible
text may be sent to the configured gateway for counting.

`doctor` and the other catalogue commands report exact duplicate groups, name
collisions, bodies over 500 lines, bodies above `kor.budget` (or `bodyBudget`),
and a combined listing above `listingBudget`. Listing costs sum the deduplicated
active rows. Warnings do not prevent writing; errors return `1` and prevent an
index write. Usage errors return `2`. No usage-history diagnosis is inferred
from the initial zero counters; outcome collection is separate work.

With `--json`, `index`, `list` and `doctor` return `schemaVersion: 1`, `hash`,
`ok`, `budgets`, `totals`, `skills`, `duplicates` and `diagnostics`. Skill rows
include selection hints, `jevVisible`, costs and method, bundle hash, source
attribution where supplied, origins and initial statistics. Diagnostics carry
`severity`, `rule`, `path` and `message`. `show` returns `schemaVersion: 1`,
`catalogueHash` and `skill`.

The catalogue hash fingerprints that deterministic snapshot, including costs,
visibility, budgets and diagnostics. There are no timestamps. Repeated inputs
and token-count results produce byte-identical output regardless of source
argument order. A gateway/estimate change can therefore change the hash. Skill
selection decisions should include this hash in their input state so a changed
catalogue receives a fresh immutable decision revision; indexing itself does
not revise existing route decisions. To reproduce a scan across outages, use
`--estimate`.

## Linear skills and PNG uploads

The two Linear skills are available in the public tier for compatible skill
consumers; they do not enable automatic selection or delivery into Kor sessions.
Use `using-linear` for tracker reads and updates, and `writing-linear-tickets`
for drafting, splitting and reviewing ticket content. They keep model routing
with Jev and use runtime credentials only. UI ticket readiness calls for actual,
captioned images for every affected screen and state.

```sh
kor linear attach-image APP-123 ./mockups/settings-error.png --alt "/settings — error — desktop" --json
```

This explicit write command works without a Kor daemon or repository mapping.
It accepts an issue identifier or UUID and a local PNG (maximum 20 MiB), with a
required one-line caption of up to 500 characters. It needs a Linear key with
issue read/write and upload permissions, from `LINEAR_API_KEY` or
`~/.config/linear/env`. Run it on the host, keeping credentials out of prompts.

Kor requests a signed upload, PUTs the PNG with all returned headers, creates a
file attachment and embeds an image under `## Screens` in the issue description.
It reads the issue back and downloads the private asset with authentication,
checking its byte count and SHA-256 against the source. The JSON success object
contains `schemaVersion`, `issue`, `attachmentId`, `bytes`, `sha256` and
`verified: true`; signed URLs and credentials are omitted. Exit 0 means verified,
1 means an operation failed, and 2 means invalid command arguments. Failures use
the shared CLI error shape.

Caption Markdown punctuation is converted to spaces and whitespace is collapsed
for readable plain text; verification compares the same normalized caption.

The issue, image bytes and normalized caption determine a stable attachment ID. Rerun the
same command to resume a partial operation or verify an existing image; changed
bytes or normalized captions create another image. Failures can leave a remote upload or
attachment. Inspect the ticket before retrying with different inputs. Avoid
concurrent description editing: Linear description writes have no conditional
update guard. Existing text is preserved from the latest read, but simultaneous
writers can still overwrite one another. The command verifies storage and ticket
references; viewing images automatically inside execution sessions is separate.
