# Worked examples

## Vague UI request

“Make settings better” has no checkable outcome, defined scope or visual target.
Replace it with a ticket such as:

```markdown
Title: Keep notification choices after a failed save

## Outcome
People can retry saving notification settings without re-entering their choices.

## Why
A failed request clears the form. Requirement SETTINGS-4 covers retry.

## Screens
/settings/notifications — save error — desktop 1280 and phone 390.
Attach the approved error-state PNG for each viewport before marking ready.

## Acceptance criteria
- [ ] Change email notifications, force the save request to fail, and confirm the
      form retains the chosen value and shows the approved error state.
- [ ] Retry after restoring the connection; reopen the page and confirm the saved
      value matches the choice. Verify in the real app at both listed viewports.
- [ ] Cancel a pending change and confirm the stored choice remains unchanged.

## Out of scope
Notification delivery, new preference types and account security settings.

## Depends on
None.
```

The text above is a draft until its two actual images are attached and inspected.
A promise to attach images is not an image. If the error design is undecided,
record that product question and keep the issue in planning.

## Split by dependency

For “add CSV exports and a download screen”, use an export endpoint ticket with
API acceptance (content, failure response and access checks), followed by a UI
ticket with populated, empty and error screen images. Link the UI ticket as
blocked by the endpoint ticket. Give the UI ticket an end-to-end download
criterion so the integration does not fall between the two tickets.

## Changed requirement

If exports now need a date range, locate the requirements and existing tickets
before creating more work. Update affected acceptance, approved screen images
and dependency links together. Explain the scope change in a comment, and
verify that no ticket still promises the old range behaviour. Keep a completed
issue's historical evidence intact; create follow-up work for new outcomes.
