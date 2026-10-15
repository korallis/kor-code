# Upload and read-back

Use this fallback only when `kor linear attach-image` is unavailable. Check the
connected tool schemas rather than guessing parameter names. Linear's
[upload documentation](https://linear.app/developers/how-to-upload-a-file-to-linear)
describes the server-side API contract.

## Connected tools

If the Linear MCP exposes attachment upload preparation and finalization, prepare
the upload, send the file bytes as instructed and finalize it against the target
issue. Some installations name these tools `prepare_attachment_upload` and
`create_attachment_from_upload`. Inspect the result: an attachment alone may not
have inserted an inline image. Add the returned private asset URL to Screens and
read the description back. Use image extraction to open the stored image.

## Server-side API

1. Read the issue and inspect the local file's real content type and byte length.
   Request `fileUpload` with that content type, filename and size. Check success
   and retain `uploadUrl`, `assetUrl` and every returned upload header in memory.
2. PUT the actual file bytes to `uploadUrl` from the host with all supplied
   headers and the content type. Check the HTTP result. Treat signed URLs as
   temporary secrets. If one expires, request another upload rather than saving
   it in the issue. Never forward the Linear API key to the upload host.
3. Read the latest issue description. Insert an inline Markdown image using `assetUrl` under Screens
   using `issueUpdate`, preserving unrelated text. If a separate file attachment
   is needed, create it for the same issue using the asset URL. Check mutation
   success, then query the issue again; do not infer success from the request.
4. Download the asset URL returned in the issue with authorized access, decode it
   and inspect the image. Send Linear authorization only to trusted Linear asset
   hosts; do not forward it across redirects to other hosts. Keep credentials
   and signed URLs out of saved evidence. For PNGs stored unchanged, compare the
   downloaded bytes' SHA-256 with the local file as well as checking the image.

## Captions and retries

Use a stable caption such as `saved-items | /saved | empty | phone 390x844 | R-1`.
Map existing captions to screen/state/viewport, then compare image content.
When replacing an unchanged row, copy the existing caption exactly if the upload
tool uses captions to identify entries. Punctuation changes can create duplicates;
use `issueUpdate` to replace the old inline entry when the tool only appends.
When replacing a stale row, preserve other screenshots, prose and attachments.
A failed verification remains pending even if an upload or mutation succeeded;
read back before retrying so a partial success does not create duplicates.
