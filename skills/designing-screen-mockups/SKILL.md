---
name: designing-screen-mockups
description: Designs complete screen mockups. Use when starting an app, mapping user flows or updating designs after requirements change.
license: MIT
metadata:
  kor.kind: skill
  kor.stages: plan,project-setup,execute
  kor.triggers: screen inventory; mock up every screen; changed UI requirement
  kor.anti: attaching existing images to issues; implementing production components
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "1100"
---

# Designing screen mockups

Deliver a traceable inventory and rendered PNGs before UI implementation. Use
requirements and user flows as the scope; record unresolved product choices
instead of inventing screens to fill gaps.

1. Read the brief, requirements, navigation and existing design tokens. List every
   route and non-route view, including dialogs and role-specific views. Map each
   to requirement IDs. Account for every flow entry, transition and destination.
2. Write `docs/mockups/INDEX.md` using the
   [inventory format](references/inventory.md). Expand each screen across its
   applicable states and viewports. Review empty, loading, error, populated and
   permission-denied states explicitly; give a reason for each inapplicable state.
   Use phone width 390 and desktop width 1280 unless project constraints specify
   others. Record heights too, so captures can be reproduced.
3. Build static HTML for each applicable screen/state, sharing a stylesheet and
   project design tokens. Keep sources under `docs/mockups/`. Use realistic,
   synthetic content and explicit state pages; live services are unnecessary.
   Labels, navigation, primary action and recovery action must be readable.
4. Serve the sources locally. In the available browser, open each page, set the
   inventory viewport and capture `docs/mockups/<screen>-<state>-<viewport>.png`.
   With `chrome-devtools-axi`, use `open`, `resize <width> <height>` and
   `screenshot <absolute-output-path>`. Capture the viewport consistently; record
   a full-page exception in the inventory. Wait for fonts and assets to finish.
5. Open the PNGs themselves. Check readable text, clipping, contrast, navigation,
   state-specific content and consistency with the brief at both widths. Fix and
   recapture defects. Static mockup buttons are illustrative; describe expected
   transitions in the inventory rather than claiming they work.
6. Reconcile inventory against requirements and inspect every referenced PNG.
   Report applicable rows, valid captures, missing captures and excluded states.
   Coverage is valid captures / applicable rows; completion requires 100%, every
   required view represented, and no unexplained routes or states. An empty
   inventory is incomplete for a UI project. Distinguish blocked rows from N/A.

On a requirement change, update the inventory first, re-render affected rows and
list every linked ticket whose image is now stale. Keep unrelated captures. Hand
off those rows to the ticket attachment workflow; report design coverage and
attachment coverage separately. A PNG on disk does not prove a ticket has it.
