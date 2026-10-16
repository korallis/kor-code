# Delivery slices and ordering

For a saved-items feature, a small milestone might contain:

| Order | Issue outcome | Depends on | Screens |
| --- | --- | --- | --- |
| 1 | Persist one user's saved items | None | Backend-only: no user-facing change |
| 2 | Save and remove items from detail view | Persistence | Detail saved/unsaved at each supported width |
| 3 | Browse and recover an empty saved list | Persistence | Saved list populated/empty/error at each supported width |
| 4 | Complete the save-to-list user flow | Detail and list work | All affected integration states |

These are illustrative, not an actual product contract. Derive real slices and
supported states from the brief. Each issue carries requirement IDs and exact
acceptance. Keep a parent tracking issue outside intake, listing full child URLs;
use native sub-issues when permitted, otherwise a task list. A parent is not a
blocking prerequisite for its children. Cyclic dependencies require resplitting.

Use repository milestones for verifiable user outcomes, not layers named
“frontend” and “backend”. Milestones can share a name across repositories but
have different IDs. In a multi-repository Project, create/assign each milestone
in the issue's repository. Priority describes urgency; numeric Order describes
execution order. Keep dependency-gated issues in planning even if they appear
first in a sorted view. Record unsupported native relations as a manual gate.
