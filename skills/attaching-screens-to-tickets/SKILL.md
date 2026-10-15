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
  kor.budget: "1100"
---

# Attaching screens to tickets

Deliver visible, verified images for every affected screen on each UI ticket.
A local path, attachment title or upload success alone is insufficient. Use the
existing project scope and ticket mapping; this workflow does not authorize new
tickets, changes to ownership or unrelated issue updates.

1. Read `docs/mockups/INDEX.md`, current requirements and each target issue,
   including its existing Screens section and attachments. Confirm the team,
   project and issue identity before writing. Map each ticket's acceptance criteria
   to exact inventory rows, including relevant states and required viewports.
   Share a screen across tickets when they both change it. Record a reason for
   tickets with no UI; exclude only those from the UI coverage denominator.
2. Inspect every selected PNG. Resolve missing, stale or mismatched mockups through
   the design workflow before marking the ticket ready. Keep a pending list of
   `(issue, screen, state, viewport, file)` entries and reuse already verified,
   unchanged images. Record each existing image URL and exact caption against its
   screen/state/viewport. Preserve other description sections and attachments.
3. Upload each pending image with `kor linear attach-image <issue> <file>` when
   the installed CLI supports it. Consult that version's help for caption and
   output options. When unavailable, use the connected Linear MCP or server-side
   API procedure in [upload and read-back](references/upload.md). Keep credentials
   on the host; never put keys or signed upload URLs in tickets or logs.
4. Ensure the issue description has a Screens section containing inline images
   with captions naming screen, route/view, state, viewport and requirement IDs.
   A file attachment may accompany the image; a plain link does not replace it.
   Re-read before editing so another contributor's changes are preserved.
5. Fetch the issue again. For each expected row, confirm the caption and inline
   image, then retrieve the stored image with authorized access and open it.
   Compare it with the intended PNG. Reject duplicate or stale inline versions
   of the same row, even when a fresh image is also present. Use MCP image
   extraction when available.
   Record the verified issue identifier against that row in `INDEX.md` only after
   this succeeds. Leave inaccessible images pending and report the actual failure.
6. Reconcile both directions: every UI ticket has all its expected rows, and every
   inventory row has at least one owning ticket. Report UI tickets verified / UI
   tickets in scope, expected images verified / expected images, uncovered rows
   and pending uploads. Completion requires 100% in both ratios and no uncovered
   applicable rows. Hold UI tickets out of Todo until their images are verified;
   follow the workspace's actual workflow state names and authorization.

When a design changes, find all linked tickets from the inventory. Upload the new
PNG using the existing caption verbatim when the row identity is unchanged;
formatting a caption differently can append a second image. Replace the affected
inline entry explicitly if the tool only appends, then read it back before
retiring an old attachment. Update requirement IDs in the inventory and caption
without leaving the superseded inline image in Screens. Reuse a matching upload on retry; after an uncertain
write, read the issue before repeating it. Report partial completion explicitly.
