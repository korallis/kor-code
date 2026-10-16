# Per-project issue trackers (LEE-1323)

A configured repository chooses `tracker: linear` or `tracker: github`. Omission
keeps Linear. A GitHub project uses repository Issues, optionally restricted to
one GitHub Project v2. Projects can mix trackers in the same Kor daemon.

`@kor-code/tracker` owns the issue, workflow, durable queue and write contracts.
The Linear package implements its API adapter and retains compatibility exports
for existing integrations. The tracker router resolves configured project scopes
and repository-qualified issue IDs. The daemon, controller and Mission Control
consume the same contract for intake, execution, comments, review and completion.
No database migration or queue reset is required.

## GitHub configuration

```yaml
repos:
  application:
    path: ~/code/application
    tracker: github
    github:
      repository: owner/application
      pullRequestLink: closes # or refs
      # Omit project to use plain Issues.
      project:
        owner: owner
        number: 7
        statusField: Status
        statuses:
          queued: Todo
          running: In Progress
          review: In Review
          complete: Done
          canceled: Canceled
        # Optional numeric (1–4) or single-select field:
        # priorityField: Priority
    defaultBranch: main
    ship: merge
    checks: [pnpm typecheck, pnpm build]
    toolAllowlist: [Read, Write, Edit, Glob, Grep, Bash]
```

Create the mapped single-select Status options in the GitHub Project first.
GitHub's initial Status field has Todo, In Progress and Done; add In Review and
Canceled, or configure matching existing option names. Doctor checks the mapping
and the viewer's ability to update the Project. Draft items and PR items are
excluded from intake. Moving an issue out of the configured Project removes it
from that project's candidate list; an execution cannot silently switch trackers.

Without a Project, Kor uses these configurable `github.statuses` labels:
`queued: kor:todo`, `running: kor:in-progress`, `review: kor:in-review`,
`complete: kor:done`, `canceled: kor:canceled`. An open issue with no status label
is queued. Kor creates missing labels on write and preserves unrelated labels.
Completing an issue closes it with reason completed; canceling closes it as not
planned. Starting, reviewing or queueing reopens it.

The intake label is the existing top-level `intakeLabel` (default `kor`). An issue
must be queued and carry that label for automatic intake. Explicit queueing uses
the same repository mapping and readiness checks. Provide an `## Acceptance`
section with concrete bullet points. Open GitHub blocking dependencies stop a run.

Priority labels default to `priority:urgent`, `priority:high`, `priority:normal`
and `priority:low` (1–4). No priority sorts last. Override the four-element
`github.priorities` list to use existing label names. With `project.priorityField`,
use a numeric field (1–4), or single-select Urgent, High, Normal, Low. Priority
changes update that field and labels. Project item order breaks priority ties.
Reads follow every issue, item, field, comment and relationship page, and avoid
loading comments, children and dependencies in candidate lists. Full execution
snapshots hydrate those relations separately.

## Credentials and access

GitHub reuses Settings credentials, `GH_TOKEN`, `GITHUB_TOKEN`, or the existing
`gh` login. Classic tokens need `repo` (or `public_repo` for public repositories),
and `project` for Project v2. Fine-grained tokens need repository Issues read/write
and pull request/content permissions for shipping and image attachment, plus
Projects read/write when a Project is configured. `kor doctor` and Mission Control
Settings report tracker access and status-map failures. No Linear credential is
required when all configured projects use GitHub.

Comments and home-box issue creation carry stable hidden markers so durable
replays reconcile an existing remote write. PR bodies contain `Closes owner/repo#N`
or `Refs owner/repo#N` according to `pullRequestLink`. The issue receives the PR
link, and Done follows Kor's existing observation of the merge.

## Images

An issue body can embed a direct HTTPS image using Markdown. To attach a local
PNG (maximum 5 MiB) and verify the saved bytes:

```sh
kor github attach-image owner/application#42 screen.png --alt "Settings /settings default"
```

Kor stores content-addressed PNGs on a dedicated `kor-assets` branch and adds
Markdown to the issue body. That repository must have an initial commit and the
token needs Contents write access. The normal source branch is unchanged.
Repeated identical uploads reuse the asset. Private raw GitHub image URLs are
retrieved through the authenticated Contents/Blob API for execution context.
The Linear `kor linear attach-image` command remains available for Linear issues.

## UI and CLI

Settings → Add project asks for the tracker and its settings. A GitHub project
needs `owner/repository`; a Project v2 number is optional. Project settings expose
status mappings and PR linkage. Projects, Issues and Next up show both trackers.
The home box creates work in the selected project's tracker and uses normal
readiness, route selection and queueing.

```sh
kor install --pilot ~/code/application --tracker github --github-repository owner/application
# Optional Project v2:
kor install --pilot ~/code/application --tracker github --github-repository owner/application --github-project-owner owner --github-project-number 7
kor run owner/application#42
kor plan owner/application#42
```

Interactive installation asks which tracker to use; noninteractive installations
retain Linear unless `--tracker github` is supplied. Existing installations and
omitted tracker fields keep their previous Linear mapping. If multiple configured
projects use one GitHub repository, use the canonical `github:PROJECT-KEY#N` ID to
select the intended project unambiguously.

`GET /api/issues?project=KEY` serves lean issue summaries from the daemon’s
paged intake observation. `GET /api/issues/:id` hydrates the full issue.
`GET /api/documents?project=KEY` serves document metadata where supported. The old
`/api/linear/*` URLs remain compatibility aliases. Action responses expose
`trackerSync`; `linearSync` remains a compatibility alias for older clients.
