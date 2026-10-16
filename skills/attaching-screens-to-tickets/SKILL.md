---
name: attaching-screens-to-tickets
description: Attaches screen images to tracker issues. Use when preparing UI tickets or replacing stale mockups after a design change.
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

Resolve the repository's configured tracker before writing. For Linear use
`kor linear attach-image` and [Linear commands](references/upload.md); update
Kor before refreshing if the installed CLI lacks `--screen`. For GitHub
use the bundled script and [GitHub images](references/github.md): publish PNGs in
the authorised repository, pin their commit and verify their issue-body links.
Keep stable screen IDs across route/caption/image changes; use distinct IDs for
states and viewports, such as `saved-items-empty-phone`.

1. Read `docs/mockups/INDEX.md`, current requirements and target issues. Confirm
   issue identity and scope. Map each UI ticket's acceptance criteria to exact
   inventory rows, including states and viewports. Record why any ticket is non-UI.
   Use the same row ID when several tickets share a screen.
2. Inspect the selected PNGs. Resolve missing or stale mockups before uploading.
   Store each row's stable Image ID in the inventory; a route or caption edit does
   not create a new ID. Preserve other ticket content and unrelated images.
3. For each mapped row, follow the selected tracker's reference, supplying the
   PNG, caption and existing screen ID. Attach each row separately and preserve
   unrelated text/images. GitHub's script requires an already published commit;
   Linear's command uploads the local PNG. Missing upload/publication capability
   is a blocker, never proof of attachment.
4. Read the issue again and inspect the downloaded image. Confirm exactly one
   inline `screen:<id>` image for each expected row and the correct route, state,
   viewport and requirement IDs. Only then record the verified ticket in INDEX.
   The command checks storage and bytes; visual correctness still needs inspection.
5. Reconcile both directions: every UI ticket has all expected rows and every
   applicable row has an owning ticket. Report tickets verified / UI tickets,
   verified images / expected images, uncovered rows and pending uploads.
   Completion requires 100% in both ratios and zero stale or duplicate keyed
   images. Hold UI tickets out of Todo/intake until verified, using the project's
   actual workflow names and authorized transitions.

On a requirement change, re-render affected rows and run the selected tracker's attachment workflow with the
same IDs on every linked ticket. Repeating identical successful inputs is safe; after
an uncertain write, rerun identical inputs. Report partial completion explicitly.
This workflow uses existing tickets; creating issues or changing ownership needs
its own task scope.
