# Image handling

For a local screenshot, execute the installed CLI on the host:

```sh
kor linear attach-image APP-123 ./mockups/settings-error.png --alt "/settings — error — desktop" --json
```

Use a public-safe image or a ticket whose access permits that image. Inspect the
PNG first and remove secrets and personal data. The file must contain PNG bytes
and be at most 20 MiB. Kor takes `LINEAR_API_KEY` from its runtime environment or
the user's Linear credential file. Supply that credential outside the session.

Kor converts caption Markdown punctuation to spaces and collapses whitespace,
then compares normalized captions on readback.

The command prepares `fileUpload`, PUTs bytes with **every returned header**,
creates a file attachment, embeds the private asset URL under `## Screens`, then
reads the issue and authenticated asset back. Success reports verified bytes and
a SHA-256 digest without printing signed upload URLs. The same issue, PNG bytes
and normalized caption yield the same attachment ID: retry the identical command after a
partial failure. A changed normalized caption creates a separate image record. Avoid
concurrent description edits during this command; the API description update
has no compare-and-swap guard. A failed command may leave an uploaded asset or
attachment, so inspect the issue before changing inputs and retrying.

Linear also supports Markdown image references in descriptions and comments;
it ingests remote images into private storage. Prefer an uploaded asset for
local files. A bare file attachment is useful for downloads; the Markdown image
makes the intended screen visible within the ticket's scope. Kor creates both.

Private `uploads.linear.app` assets require authentication when fetched later.
Fetch on the host; keep keys and temporary signed URLs out of committed docs,
comments and session context. The current CLI verifies storage and visibility in
the issue; automatic delivery of ticket images into execution sessions is a
separate capability. Inspect images explicitly when a task depends on them.

Sources: [Linear file uploads](https://linear.app/developers/how-to-upload-a-file-to-linear),
[Linear agent interactions](https://linear.app/developers/agent-interaction).
