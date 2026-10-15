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

Direct publication asks Jev to route a PR-writing pass among the live verified
models. The selected model receives a bounded, redacted diff at the verified head,
the issue, repository check results, and acceptance findings. Its structured answer
supplies the title, plain-prose summary, user-facing changelog, and testing summary.
Only applied route decisions are recorded under `route-pr-<execution>-<head>`
and reused for that commit. A low-confidence or clarification answer is discarded,
then Jev is asked once more with a narrower prose-only task. If the second answer
is still unapplied, Kor creates the standard layout from issue text and recorded
verification evidence, with a visible `PR prose fallback` note requesting review
of the summary and changelog. Its title keeps a conventional issue title or uses
`chore(task): <issue title>`; it does not guess the change type. No model is chosen
by the fallback. If PR creation needs retrying, Jev can be asked again for the
same commit; existing PR bodies are still left unchanged.
Legacy rejected audit records are ignored; a new applied decision uses a retry
suffix instead of replaying the rejection.

An empty verified-model registry, unavailable service, failed completion, or
invalid generated content still blocks PR creation for retry. The branch may have
been pushed before this step.

The bundled `pr-standard` layout appears in this order:

1. `What does this PR do?` explains the user outcome and reason, with a tracker reference.
2. `Changelog` uses `Added:`, `Changed:`, or `Fixed:` for each user-visible change,
   or a no-changelog note for maintenance.
3. `How was it tested?` summarizes the actual evidence and limits, then includes
   recorded commands, exit codes, output, and the
   direct-delivery gate result. It does not claim unrecorded browser checks.
4. `Screenshots` links passing verification evidence with a public HTTPS image
   source ending in `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif`. Kor does not upload
   local files. Without a source, it says that screenshot evidence is missing.
5. `Checklist` contains acceptance findings, using manifest descriptions where
   available. Only passing findings are ticked.

The generated default keeps all five sections even when screenshot evidence is
missing. Large command output is omitted at whole-block boundaries so the
checklist stays visible and code fences stay closed.

The generated title uses `type(scope): plain outcome`, matching the diff rather
than tracker labels. The supported types are `feat`, `fix`, `refactor`, `perf`,
`docs`, `ci`, and `chore`. Titles cannot contain newlines or trailing periods and
are capped at 200 characters. Model input and output both pass through publication
redaction; raw verification evidence remains attached so prose can be checked
against measured results.

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
| `{{summary}}` | Plain-prose outcome and tracker reference |
| `{{changelog}}` | User-facing Added/Changed/Fixed lines or maintenance note |
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
When `ship: approve` holds a verified execution, the waiting transition and its
Linear comment are queued in one transaction. The comment reports passing checks
and acceptance findings and directs the operator to approve in Mission Control.
Each distinct block reason gets a new comment ID, preserving earlier reasons;
retries of the same reason keep their ID. Review evidence can still update the
existing review comment. Stable IDs and the outbox make write retries idempotent.

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
It verifies the five ordered headings, model-generated prose, bounded evidence, committed
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

The offline gate, forge, Linear, and cleanup scenarios above are **Illustrative
contract replays**. Separate live acceptance exercised two real coding sessions
against a private scratch repository, each passing two checks and three acceptance
criteria and opening a ready PR through direct delivery. Both PRs were closed
without merging. Linear's approval-wait comments and two distinct block comments
were read back through the API; the first block's text and update timestamp stayed
unchanged. The PR route decisions were present in the durable audit, and the final
PR preserved relative source paths in recorded check commands while redacting local
absolute paths and secrets in the replay.

The PR-route recovery replay checks low/high confidence, two uncertain answers,
retrying the same commit, accepted-route reuse, and legacy rejected audit rows.
A separate live run forwarded real Jev calls while fault-injecting two
below-threshold confidences. It passed two checks and three acceptance criteria,
then opened a ready PR with the standard fallback note; zero rejected PR-route
rows were persisted. A later live description request for the exact same commit
selected a route at 0.80 confidence and completed the model-written prose. That
scratch PR was closed without merging.

The initialized no-mistakes pipeline, configured GitHub CI, merge observation, and
cleanup remain replay coverage; the live scratch repository had no CI and no
PR was merged.

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
