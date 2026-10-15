# Screen inventory format

Use `docs/mockups/INDEX.md` as the screen source of truth. Paths below are relative
to that file. Give screens stable IDs so a route rename does not break ticket
traceability. Use the project's existing requirement IDs, or assign IDs in its
requirements document before mapping screens.

## Required views

| Screen | Route or view | Requirement IDs | States | Exclusions with reason |
| --- | --- | --- | --- | --- |
| saved-items | /saved | R-1 | empty, loading, error, populated, permission-denied | none |
| delete-item | dialog on /saved | R-2 | confirmation, deleting, error | empty/loading/populated/permission-denied: parent view owns these states |

This table is the denominator check: compare it to the requirements and user
flows before counting captures. A complete set of files for an incomplete list
of views is incomplete coverage.

## Captures

One row per applicable screen/state/viewport. Expand every state above for each
required viewport; the two rows below illustrate the columns, not a complete set.
Give every capture row a stable Image ID, including its state and viewport.
Keep the ID when its route, requirements or caption change; pass it to the ticket
upload command as `--screen`. Use explicit filenames without spaces. Record a
ticket only after read-back.

| Image ID | Screen | Route or view | Requirement IDs | State | Viewport | Width | Height | HTML | PNG | Verified tickets |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| saved-items-empty-phone | saved-items | /saved | R-1 | empty | phone | 390 | 844 | saved-items-empty.html | saved-items-empty-phone.png | pending |
| saved-items-empty-desktop | saved-items | /saved | R-1 | empty | desktop | 1280 | 900 | saved-items-empty.html | saved-items-empty-desktop.png | pending |

Record transitions such as "empty: Add item opens the create-item dialog" below
the tables. Record blockers and requirement assumptions separately from excluded
states. A state awaiting a product decision remains a coverage gap.

## Coverage report

Report required views covered / total required views, applicable capture rows,
PNGs verified / applicable rows, missing or stale PNGs, and excluded states with
reasons. Validate that each file decodes as PNG, matches its declared viewport
(or documented full-page exception), and depicts its stated screen and state.
File existence and filename matching alone do not establish coverage.
