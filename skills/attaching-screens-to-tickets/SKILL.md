---
name: attaching-screens-to-tickets
description: Attaches screen images to Linear issues. Use when preparing UI tickets or replacing stale mockups after a design change.
license: MIT
metadata:
  kor.kind: skill
  kor.stages: plan,project-setup,execute
  kor.triggers: screenshot on every ticket; attach mockups; refresh ticket images
  kor.anti: designing new screens; general issue creation or status updates
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "850"
---

# Attaching screens to tickets

Use `kor linear attach-image` with a stable `--screen` ID for every inventory
row. The command replaces that row's inline image regardless of caption or PNG
changes, verifies the saved bytes, and collapses duplicate images with that ID.
Keep IDs stable across requirement changes; use distinct IDs for states and
viewports, such as `saved-items-empty-phone` and `saved-items-empty-desktop`.

1. Read `docs/mockups/INDEX.md`, current requirements and target issues. Confirm
   issue identity and scope. Map each UI ticket's acceptance criteria to exact
   inventory rows, including states and viewports. Record why any ticket is non-UI.
   Use the same row ID when several tickets share a screen.
2. Inspect the selected PNGs. Resolve missing or stale mockups before uploading.
   Store each row's stable Image ID in the inventory; a route or caption edit does
   not create a new ID. Preserve other ticket content and unrelated images.
3. For each mapped row, run the host-side command from
   [commands and verification](references/upload.md), supplying the PNG, caption
   and the row's existing `--screen` ID. Upload each row separately. If the CLI
   lacks `--screen`, update Kor before refreshing ticket images.
4. Read the issue again and inspect the downloaded image. Confirm exactly one
   inline `screen:<id>` image for each expected row and the correct route, state,
   viewport and requirement IDs. Only then record the verified ticket in INDEX.
   The command checks storage and bytes; visual correctness still needs inspection.
5. Reconcile both directions: every UI ticket has all expected rows and every
   applicable row has an owning ticket. Report tickets verified / UI tickets,
   verified images / expected images, uncovered rows and pending uploads.
   Completion requires 100% in both ratios and zero stale or duplicate keyed
   images. Hold UI tickets out of Todo until verified, using the workspace's
   actual workflow names and authorized transitions.

On a requirement change, re-render affected rows and call attach-image with the
same IDs on every linked ticket. Repeating a successful command is safe; after
an uncertain write, rerun identical inputs. Report partial completion explicitly.
This workflow uses existing tickets; creating issues or changing ownership needs
its own task scope.
