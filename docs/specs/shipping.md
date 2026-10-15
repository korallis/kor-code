# Shipping verified issues

`kor serve` owns delivery after the controller's checks and acceptance judgments pass.
It commits the execution worktree on `kor/<issue identifier>`, then chooses the gate
from `no-mistakes axi status` in that worktree:

- An initialized repository uses `no-mistakes axi run --intent … --no-publish-intent --base-branch … --wait 1s`.
- Only the explicit **repo not initialized** response permits the direct
  `git push` and `gh-axi pr create` fallback.
- An unavailable binary, daemon, invalid response, approval gate, or failed pipeline
  keeps delivery blocked. None permits a fallback or a merge.

The adapter supports the TOON contract exposed by no-mistakes 1.84 and gh-axi.
It never initializes, restarts, updates, or stops the shared no-mistakes daemon.
It does not pass `--yes`, skip steps, answer reviewer questions, or approve findings.
An operator handles a gate in the execution worktree with the commands printed by
`no-mistakes axi status`; Kor observes the same recorded run on its next poll.
`kor retry` does not rerun a verified session that already has shipping state.

Verification records the base revision and changed paths. Shipping stages only
those paths, using literal Git pathspecs. Unrelated files created after verification
and sensitive untracked paths (`.env*`, private keys, credential files, agent config
directories, and logs) remain untracked. Sensitive or unverified paths already in
the index or session commits block publication. A saved verification report from
an older version without this path manifest also blocks publication and needs
verification again. This is a filename policy, not a content secret scanner.

Direct PR titles and bodies redact runtime secrets, credential assignments,
recognizable provider tokens, private-key blocks, and local filesystem paths.
Each evidence field is capped at 4,000 characters and the body stays below 60,000
characters. The pipeline receives `--no-publish-intent` so Linear descriptions are
not copied into the generated public Intent section.

## Pull request format

Direct publication uses the bundled `pr-standard` layout in this order:

1. `What does this PR do?` contains the issue title and tracker reference.
2. `Changelog` contains a `Changed:` line from the issue title.
3. `How was it tested?` contains recorded commands, exit codes, output, and the
   direct-delivery gate result. It does not claim unrecorded browser checks.
4. `Screenshots` links passing verification evidence with a public HTTPS image
   source ending in `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif`. Kor does not upload
   local files. Without a source, it says that screenshot evidence is missing.
5. `Checklist` contains acceptance findings, using manifest descriptions where
   available. Only passing findings are ticked.

The generated default keeps all five sections even when screenshot evidence is
missing. Large command output is omitted at whole-block boundaries so the
checklist stays visible and code fences stay closed.

A title already matching `type(scope): outcome` is preserved. The supported types
are `feat`, `fix`, `refactor`, `perf`, `docs`, `ci`, and `chore`. Other issue titles
use `chore(task): <issue title>` rather than guessing a change type. Newlines and
trailing periods are removed, secrets and paths are redacted, and titles are
capped at 200 characters. The tracker reference remains in the body.

Kor reads the first committed template at the verified publication head in this
order: `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`,
`pull_request_template.md`, `PULL_REQUEST_TEMPLATE.md`,
`docs/pull_request_template.md`, `docs/PULL_REQUEST_TEMPLATE.md`. Uncommitted files
and symlink targets are not read. Named templates in a `PULL_REQUEST_TEMPLATE/`
directory are not selected automatically.

Repository templates keep their own headings and checklist state. These optional
placeholders insert generated content at the chosen position:

| Placeholder | Content |
| --- | --- |
| `{{summary}}` | Issue title and tracker reference |
| `{{changelog}}` | `Changed:` line |
| `{{verification}}` | Commands, results, and verification limits |
| `{{screenshots}}` | Public image evidence or a missing-evidence note |
| `{{checklist}}` | Acceptance findings |

When a template omits verification, checklist, or screenshot placeholders, Kor
appends that evidence after a separator. Template prompts and custom checkboxes
remain as written; Kor does not claim that repository-specific manual checks
passed. A template over 12,000 characters, or a rendered body over 60,000, blocks
PR creation. Redaction covers template text as well as evidence. Existing PRs and
PRs created by the no-mistakes pipeline are observed without rewriting their bodies.

## State and evidence

```text
running → checks + Jev acceptance → shipping → review → complete
                                       ↓         ↓
                                    blocked    closed without merge → failed
```

`shipping` includes committing, starting or observing the pipeline, and publishing.
`review` means GitHub has an open, ready PR for this execution's branch and base.
The Linear outbox links the PR with `attachmentLinkGitHubPR`, comments with evidence,
and moves the issue to In Review. An absent In Review state blocks execution before
the model launches.

`complete` means GitHub returned a non-null merge timestamp. Kor does not merge.
It durably queues the Done write before cleanup. A closed, unmerged PR is `failed`;
it keeps the issue out of Done and retains the worktree for inspection. When
calibration is enabled, these observations record merged or rejected outcomes
through the controller's existing outcome hook.

`kor status --json` and the HTTP/file snapshots expose `verification`, `shipping`,
and `pullRequestUrl`. `shipping.stage` retains the submitted commit, mode, pipeline
run ID, and PR identity as they become known. `shipping.evidence` contains each
pipeline step's status/duration/log command, publication, and GitHub check runs and
commit statuses at the current PR head. A skipped or pending step is unresolved.
Missing CI, unavailable CI, or a truncated check listing is unresolved, never a pass.
Local repository checks remain separate from GitHub CI.

SQLite schema version 5 adds `shipping` and `review` assignment states while
preserving existing assignments, leases, manifests, and outbox entries. The daemon
does not reclaim delivery as executable work on restart. Publication recovers an
existing PR by branch and commit; a saved pipeline run is inspected by ID.
Stable Linear comment IDs and the transactional outbox make write retries idempotent.

## Cleanup

After GitHub reports a merge and pending Linear writes have flushed, cleanup checks
the execution path under this daemon's worktree root, its ownership marker, the
registered Git worktree branch, and a clean working tree. It removes that worktree
without `--force`, retains the branch, and records cleanup evidence. Dirty or
mismatched worktrees stay in place with an error in status; cleanup retries on later
polls. An interruption after removal is safe to resume.

## Configuration and operation

Install dependencies and build with `pnpm install --frozen-lockfile` and `pnpm build`.
The daemon host needs Git, authenticated `gh-axi`, and no-mistakes. Repository
configuration supplies a GitHub URL in `remote` (or a GitHub `origin` URL), the
default branch, repository checks, and the session tool allowlist. Linear and
TypeSafe credentials use the existing runtime loaders.

```sh
pnpm kor serve
# In another terminal, after inspecting the issue and repository mapping:
pnpm kor run LEE-123 --dry-run
pnpm kor run LEE-123
pnpm kor status --json
pnpm kor logs EXECUTION-ID
```

The configured poll interval controls delivery and merge observations. There is no
automatic merge, force push, branch deletion, or shared infrastructure administration.

## Validation scope

The committed replay runs offline, after building the packages:

```sh
pnpm build
pnpm shipping:proof
```

`scripts/shipping-proof.mjs` uses real Git commits, SQLite migration and restart,
repository checks, and HTTP snapshots. Session, Jev, Linear, forge, pipeline, and
worktree cleanup responses are fixtures; the replay makes no network requests or
worktree administration calls. It covers approval gates, daemon outage, missing
binaries, malformed gate output, no duplicate session/PR after restart,
absent/failing/passing CI, closed-unmerged PRs, merge observation, dirty and mismatched
worktree retention, and cleanup retry. The v4 database fixture is constructed from
its old schema, so migration proof does not depend on git history.

The replay commits the intended files while leaving a decoy `.env.local` and an
unrelated file untracked. It also blocks an already-staged or session-committed
secret file and inspects the generated PR body for leaked credentials and paths.
It verifies the five ordered headings, title fallback, bounded evidence, committed
repository template precedence, plain templates, screenshot links, and unticked
unresolved acceptance findings. Templates are committed in the scratch repository;
an uncommitted replacement does not change the rendered body.

```text
publication proof: verified files committed; .env.local and unrelated file excluded; PR secrets/local paths redacted; body <= 60000 characters; literal filename preserved
sensitive-path proof: staged and session-committed .env.local blocked before publication
migration proof: v4 -> v5; execution/lease/metadata/outbox preserved; shipping not claimable; retry does not rerun verified work
```

Scratch artifacts are retained under a fresh directory in `$TMPDIR` (or
`KOR_PROOF_DIR` when supplied); the command prints its location. Earlier scratch
validation also used live Jev acceptance judgments and a real gh-axi read.

The gate, forge writes, Linear writes, and cleanup are **Illustrative contract
replays**, not a live end-to-end shipping claim. A live run of the daemon against a
repository with no GitHub `origin` was captured for the [user guide](../user-guide.md):
verification passed, shipping stopped with `git failed (2): error: No such remote
'origin'`, and the verified work stayed in its worktree. A live initialized-repo run
that reaches a pull request remains necessary before calling the entire shipping
flow **Validated**.

Jev (`jev-1.13.0`) selected daemon-owned delivery with confidence 0.96, preserving
approval gates with confidence 1.00, and cleanup only after merge with confidence
1.00.

When attaching a no-mistakes run, Kor checks the recorded submitted head together with its run ID and branch. The pipeline owns rebase and repairs, so its current head may differ before the first attachment. A startup response without submission identity is refreshed by run ID when needed. Older responses without that metadata must still match the original head exactly; branch alone never establishes ownership. Once attached, the durable run ID fences later polls and restart recovery.

The no-mistakes step status `completed` produces passing pipeline evidence. Kor also recognizes `passed` for compatibility; failed steps produce failing evidence, and other step states remain unresolved.

Merged worktrees with uncommitted files are retained with `cleanup: retained`
and unresolved cleanup evidence. Kor stops polling their terminal pull request.
Inspect and save those files before removing the worktree manually. Closed pull
requests are terminal observations; reopen them through a separate operator workflow.
A verified path excluded by the publication policy blocks shipping with its path
in the diagnostic; remove or rename it and reverify. CI evidence changes update
the existing Linear shipping comment even when the lifecycle state is unchanged.
Only regular committed template blobs are rendered, and placeholder expansion is
one pass, so command output containing template syntax remains literal.
