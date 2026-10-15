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

## Private pack

Create the pack, preview an explicit source, then copy it:

```sh
kor skills init
kor skills import --from ./existing-skills --dry-run
kor skills import --from ./existing-skills
kor skills doctor --estimate
kor skills guard
```

The destination is `XDG_CONFIG_HOME/kor/skills` (default
`~/.config/kor/skills`), or `skills.privatePath` from configuration. `init`
prints the path, sets directory mode `0700`, and creates a `0600` `deny.txt`
and `.gitignore` guard note without replacing existing files. Put one private
literal string per line in `deny.txt`; blank lines and lines starting with `#`
are ignored. Do not put this list in the public repository. A private directory
inside a Git worktree must already be ignored and contain no tracked files;
initialization and import refuse other worktree locations.

Import only reads the explicitly supplied source. It discovers skills in the
same way as `index --from`, copies regular files (including references, scripts
and assets), and never links, runs bundled scripts or writes back to the source.
Links used to discover a bundle resolve to their physical source; links inside
bundles fail. `.git` and `node_modules` are excluded. New directories have mode
`0700`; files have `0600`, or `0700` when the source has owner execute permission.
Existing destination names fail rather than being replaced. Exact duplicates in
the source are copied once. The report includes duplicate count, byte count,
conflicts, lint findings and a `local-only` suggestion for each imported skill.

`--dry-run` performs discovery, stages copies and runs validation in Kor state;
it leaves the source and destination unchanged and deletes the staging directory.
Import validates format, local references and the same no-routing rules as public
lint. Private imports accept missing licenses, extra top-level fields and non-string
non-Kor metadata, and do
not impose public description wording, overlap, reference layout or body-length
rules. Unknown routing fields still fail. Invalid imports leave the destination
unchanged; a filesystem failure during final copying may leave a partial new
bundle. Remove that incomplete bundle before retrying. No existing bundle is
replaced. Private content remains subject to repository permissions when delivered.

Set the visibility on guidance that must stay out of Jev's request:

```yaml
metadata:
  kor.visibility: local-only
```

Import preserves source bytes, so it suggests this metadata rather than adding
it. Private guidance defaults to `skills.jev: names-only` even without the field.
An explicit `local-only` remains restricted when `skills.jev: full` is configured.
Restricted catalogue rows record effective `visibility: local-only` and
`jevVisible: names-only`, use
`Private guidance (local-only).` as the summary, omit triggers and anti-triggers,
and estimate costs locally. Bodies and references are absent from every catalogue
row; consumers must use `jevVisible` to send only the name and label for restricted
rows. `doctor` prints each row's origin tier, visibility and Jev visibility so both
tiers are visible together. Private sources also run the private import lint rules.

`kor skills guard [DIRECTORY] [--json]` checks the bundled public `skills/` by
default, or an explicit public directory. It fails on a literal case-insensitive
match of any private skill directory name or `deny.txt` entry in a public path or
file, an absolute home path, a symlink, overlapping tiers, an unignored private
pack in a worktree, or tracked private files. Private matches are redacted from
its diagnostics. Because names are guarded too, a private override sharing a
public name is reported even though the catalogue permits that override.

CI runs guard with its isolated private configuration. CI cannot know an owner's
local deny list: run it locally before publication as well. This literal scan
cannot establish that arbitrary material is public-safe; review the content and
licensing before publishing it. `init`, `import` and `guard` require no daemon or
credentials, support `--json`, and use exit `0` for success, `1` for failed checks
or I/O, and `2` for invalid arguments.

## Install pinned skills

Imports copy files into exactly one Kor tier: `skills/` beside Kor's packages
(`--tier public`), or `$XDG_CONFIG_HOME/kor/skills` (default
`~/.config/kor/skills`, `--tier private`). A newly created private root has mode
0700. There is no arbitrary destination option. Harness skill directories are
never installation targets. Imports do not make skills available to execution
sessions; catalogue selection and session delivery are separate features.

```sh
kor skills add https://github.com/cursor/plugins.git@e5136d82418d \
  --subpath pstack/skills \
  --skill principle-laziness-protocol principle-subtract-before-you-add \
  --tier private --adapt-frontmatter
```

Use a credential-free HTTPS Git URL and a pinned commit, never a branch or tag.
Full 40-character SHAs work on any supported remote. Short SHAs (7–39 characters)
are resolved from advertised refs, or through GitHub's public commits API for an
older GitHub commit; resolution must match the supplied prefix. Private local
repositories can use `file:///absolute/path@<full-commit>`. Embedded credentials,
URL query strings and fragments are rejected. Authenticated remote repositories
are outside this command's scope.

`--skill` accepts one or more directory names and can be repeated. Without it,
all discovered skills are selected. `--subpath` limits discovery inside a source
repository and resolves duplicate skill names in monorepos. Missing or ambiguous
names fail. Kor fetches with depth 1 into a temporary directory, copies the chosen
bundles, and lints them together with the destination tier before writing installed
files. No source scripts or hooks run. Symlinks in bundles or destination parents
are rejected. Existing names are never overwritten by `add`.

Upstream skills must meet Kor's format. The explicit `--adapt-frontmatter` option
fills a missing `license` from the upstream licence file and rephrases descriptions
that lack a third-person action as `Guides development. Use when …`, removing a
leading `Apply when`, `Apply before`, `Use when` or `Use for`. It preserves body
content (normalising CRLF to LF), leaves other fields intact and records the option
for future updates. It does not remove routing instructions or repair broken
references. Review the resulting description for accuracy; overlapping skills
still need authored `kor.anti` hints. Adapt larger upstream workflows separately.

Every import needs a licence file at the skill directory or a parent within the
fetched repository. The nearest `LICENSE`, `LICENCE` or `COPYING` file (optionally
`.md`/`.txt`) is copied as `LICENSE.upstream`. Public imports require a recognised
permissive licence: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense
or CC0-1.0. Recognition is a conservative text check, not a legal review. Review
additional terms and public suitability before importing. Private imports may
record `UNKNOWN`; they still require a licence file, valid format and no routing
instructions. Private bundles may declare `kor.visibility: local-only`.

Each tier gets a `skills.lock.json` (`schemaVersion: 1`, `skills` array). Each entry
records `name`, credential-free source `url`, full `commit`, source `subpath`,
installed content `hash`, `license`, source `licenseFile`, `licenseHash` and
`adaptFrontmatter`. Content hashes use SHA-256 over sorted relative names, file
bytes and modes, with the same fingerprint function as Kor's install journal;
`LICENSE.upstream` and adapted frontmatter are included. `SOURCES.md` gives readable
attribution. Commit the public tier, lockfile and attribution together; keep the
private tier outside public source control.

## Check and apply updates

```sh
kor skills update --check
kor skills update --check --tier private --skill principle-laziness-protocol --json
kor skills update --apply --tier private
kor skills update --check --tier private --commit <full-commit>
```

The default is `--check` across both tiers. `--check` and `--apply` are mutually
exclusive. Each source is shallow-fetched at upstream HEAD, or the explicit
`--commit` pin. The report shows old/new commits, a Git diff stat of the installed
and proposed bundles, and licence status (`new`, `unchanged`, `changed`), including
changes to the licence text or its source path. Public licence eligibility appears
as `allowed` or `blocked`. A commit-only change advances the lock even when the
content diff is empty. An unchanged commit and content is a no-op.

`--check` changes no tier or journal files. `--apply` re-lints the complete proposed
tier, requires an eligible public licence and updates copies, attribution and pins.
A change in permissive licence terms is reported and can be applied explicitly;
read `--check` before applying. There is no paired skill evaluator in this import
command: it reports that evaluation has not run. Review guidance and verify its
outcomes before offering it to sessions.

Both modes reject edits that differ from a locked bundle hash. Save those edits
and restore the locked files before retrying. Destination symlinks and conflicting
names are errors. An in-process failure restores the preceding version. Operations
serialize through a PID lock beside the skills journal; a busy operation must
finish before another mutation can start. If a process was killed, read the PID
in `$XDG_STATE_HOME/kor-install/skills.busy`, confirm that process has exited, then
remove only that stale lock and run `kor uninstall` to replay the recovery journal.
Kor leaves stale locks for explicit recovery instead of guessing whether an owner
is still active.

The skills install journal uses Kor's existing snapshot and restoration machinery
under `$XDG_STATE_HOME/kor-install/skills` (default
`~/.local/state/kor-install/skills`). It stores the original files for uninstall,
plus each operation's preceding version in `history/<id>/` with a manifest. These
backups may contain private guidance; keep them private. No credentials or daemon
are required. Temporary fetch directories are removed after each command.

`kor uninstall` reverses all imports, including public imports, restores original
lock/attribution files, and removes the skills journal after success. It works even
when only skills were installed, retains unrelated tier files, and refuses to
discard later edits. Save edited files, restore the installed snapshots named in
the error, and retry. An interrupted transaction is recovered before restoring
the original imports. `kor uninstall --purge` uses the same skills restoration;
normal Kor configuration retention follows the existing uninstall contract.

`--json` produces `schemaVersion`, `ok`, `applied`, `changes` and `lint`. A change
contains `tier`, `name`, `before` (null for add), `after`, `changed`, `diffStat`,
`licenseStatus` and `licenseAllowed`. `before`/`after` use the lock entry format;
`lint` uses the reports described above. Exit 0 means the check or install passed;
1 means lint, licence, conflict or I/O failure; 2 means invalid arguments. A check
that finds an available, valid update still exits 0. Failures use the shared CLI
error shape. These commands never load gateway or Linear credentials.
