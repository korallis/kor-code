# Shipping verified issues

`kor serve` owns delivery after the controller's checks and acceptance judgments pass.
It commits the execution worktree on `kor/<issue identifier>`, then chooses the gate
from `no-mistakes axi status` in that worktree:

- An initialized repository uses `no-mistakes axi run --intent … --base-branch … --wait 1s`.
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
it keeps the issue out of Done and retains the worktree for inspection.

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

The T6 scratch replay exercises real local Git commits, the SQLite migration and
restart path, the loopback HTTP snapshot, and live Jev acceptance judgments. It
replays the documented no-mistakes and gh-axi command contracts and the personal-key
Linear write lifecycle using fixtures. It covers approval gates, daemon outage,
no duplicate session/PR after restart, absent/failing/passing CI, closed-unmerged
PRs, merge observation, dirty-worktree retention, and cleanup retry.

The worker's delivery contract forbids running a no-mistakes pipeline or managing
worktrees, so the gate, forge writes, Linear writes, and cleanup are **Illustrative
contract replays**, not a live end-to-end shipping claim. The real gh-axi read
envelope and this change's ready PR are checked separately. A live initialized-repo
pilot remains necessary before calling the entire shipping flow **Validated**.

Jev (`jev-1.13.0`) selected daemon-owned delivery with confidence 0.96, preserving
approval gates with confidence 1.00, and cleanup only after merge with confidence
1.00. The T6 PR records the decision output and executed proof commands.
