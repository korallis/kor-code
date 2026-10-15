# MCP operations

Tool names differ across Linear connectors. Inspect the connected tool schemas;
use their supported fields and pagination rather than copying guessed arguments.

| Need | Order and completion check |
| --- | --- |
| Find work | Search issues by identifier or distinctive title; inspect candidate descriptions and project/team before choosing. Follow pagination when checking duplicates. |
| Understand scope | Fetch issue, comments, attachments, blocking relations and parent; fetch linked project documents relevant to the change. |
| Prepare a write | List the target team's states and labels. Resolve member and project IDs when changing those fields. |
| Update | Submit only intended fields; fetch the record and compare those fields, including preserved description content. |
| Create | Search first, resolve team/project, create one bounded record, save its returned ID, then fetch it before creating dependent records. |
| Report progress | Add a concise evidence or blocker comment; read comments back. Check for an already-written comment before retrying an uncertain request. |
| Attach an image | Use the connector's upload-preparation and upload-completion tools if available; otherwise run Kor's host CLI. Verify both the image reference and readable image bytes. |

A connector may expose `prepare_attachment_upload`, `create_attachment_from_upload`
and `extract_images`. Use those names only when they actually exist. Image
extraction is for inspection; upload preparation alone does not attach an image.
A text-only readback cannot establish what an image depicts: inspect the image
when matching a screenshot to a screen or state.
