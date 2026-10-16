# GitHub project planning skills

LEE-1323 adds GitHub Issues/Projects v2 guidance alongside Linear. The selected
tracker belongs to each Kor project; hosting code and pull requests on GitHub
does not by itself select GitHub as the tracker.

| Work | Linear project | GitHub project |
| --- | --- | --- |
| Read/update tracker records | `using-linear` | `using-github` |
| Create/refine/split issues | `writing-linear-tickets` | `writing-github-tickets` |
| Brief → docs → mockups → delivery plan | `setting-up-a-project` | Same playbook, GitHub branch |
| Full documentation set and claim audit | `writing-project-docs` | Same skill and templates |
| Every route/state/viewport rendered | `designing-screen-mockups` | Same skill and inventory |
| Images on every UI issue | `attaching-screens-to-tickets` | Same skill, GitHub attachment script |

Jev's catalogue exposes `kor.trackers` eligibility. Tracker-specific skills are
filtered before selection and remain unavailable to mismatched pins, outage
fallback and overrides. Shared skills have no tracker restriction. See
[selection policy](skills.md#per-project-tracker-guidance).

## Start a GitHub project

Use the shared setup playbook with the product brief and the authorised target
repository/Project. It preserves the same full [documentation set](project-setup.md),
requirement IDs, claim audit, mockup inventory and readiness gates as Linear.
The [Projects v2 reference](../skills/using-github/references/projects.md) describes
verified gh-axi/GraphQL operations for:

- Project creation, repository linking and a README linking versioned docs.
- Discovery of Status options, Priority and numeric Order fields.
- Repository milestones, small one-PR issues, parent/sub-issues and blocking.
- Project membership, field values, ordering and mutation readback.

Repository milestones group delivery slices. Sub-issues express decomposition;
blocking expresses prerequisites. Task lists and Order fields are visible plans,
not enforcement. When native relations are unavailable, the skills retain
explicit prerequisite links and keep blocked work outside ready Status/intake.
No GitHub readiness CLI is invented; API and browser readback provide evidence.

## Attach and refresh mockups

GitHub's public API does not provide the issue editor's asset-upload endpoint.
The bundled [image helper](../skills/attaching-screens-to-tickets/scripts/attach-github-image.mjs)
uses approved PNGs already committed and pushed to the issue's repository, pinned
to a full commit SHA. A planning branch is sufficient. Its
[usage and limits](../skills/attaching-screens-to-tickets/references/github.md)
cover private images and the 1 MiB Contents API limit.

Each image uses a stable `screen:<id>` caption. The helper compares local and
authenticated repository bytes, replaces the keyed issue-body image, collapses
duplicates and reads the body/image back. Repeating identical inputs makes no
write. Refreshing captions or pixels keeps the ID; unrelated text, other images
and fenced examples remain. API verification establishes stored bytes and links;
browser inspection establishes readable content and rendering. Both gates precede
marking UI work ready. The script does not publish files or change issue status.

## Validation

The LEE-1323 proof uses a disposable repository and personal Project under
`korallis`, with synthetic documentation, phone/desktop mockups, a milestone,
parent and child issues, native blocking, Project fields and image attachments.
Observed coverage: 2/2 mockup rows, 2/2 Project UI issues with 4/4 images, plus
a plain issue with both images and zero Project membership. Identical repeats
made no writes; caption refresh removed a duplicate and preserved a fenced
example and unrelated text. Both tracker session packs excluded the other
provider's skills, including pins, overrides and outage fallback.
Scratch data and API readbacks stay outside the source checkout. The repository
and Project are deleted after validation; recorded URLs are historical proof
identifiers and are expected to stop resolving. See the PR's validation record
for observed coverage and cleanup results. No test files are added.
