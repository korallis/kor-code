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

```text
publication proof: verified files committed; .env.local and unrelated file excluded; PR secrets/local paths redacted; body <= 60000 characters; literal filename preserved
sensitive-path proof: staged and session-committed .env.local blocked before publication
migration proof: v4 -> v5; execution/lease/metadata/outbox preserved; shipping not claimable; retry does not rerun verified work
```

Scratch artifacts are retained under a fresh directory in `$TMPDIR` (or
`KOR_PROOF_DIR` when supplied); the command prints its location. Historical T6
scratch validation also used live Jev acceptance judgments and a real gh-axi read.

The worker's delivery contract forbids running a no-mistakes pipeline or managing
worktrees, so the gate, forge writes, Linear writes, and cleanup are **Illustrative
contract replays**, not a live end-to-end shipping claim. The real gh-axi read
envelope and this change's ready PR are checked separately. A live initialized-repo
pilot remains necessary before calling the entire shipping flow **Validated**.

Jev (`jev-1.13.0`) selected daemon-owned delivery with confidence 0.96, preserving
approval gates with confidence 1.00, and cleanup only after merge with confidence
1.00. The T6 PR records the decision output and executed proof commands.
