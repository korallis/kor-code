# Commands and verification

Run on the host with runtime Linear credentials and permission to update the
selected issues. The PNG must be no larger than 20 MiB.

```sh
kor linear attach-image APP-123 docs/mockups/saved-items-empty-phone.png --screen saved-items-empty-phone --alt '/saved | empty | phone 390x844 | R-1' --json
```

Use one stable ID per screen/state/viewport, containing lowercase letters,
digits and single hyphens, at most 128 characters. The ID is written into the
inline caption as `screen:saved-items-empty-phone | ...`; keep it unchanged when
requirements, wording, route or image bytes change. The ID plus caption must fit
within 500 characters. Read `--help` from the installed CLI for its contract.

`verified: true` means the issue references and authenticated downloaded bytes
match the uploaded PNG. JSON also reports the `screen` ID and SHA-256. Signed
upload URLs and credentials are omitted. Re-read the issue through the connected
Linear API or MCP, then open the stored image; do not treat a local PNG as proof
that a ticket carries it.

Repeat the command with the same ID to replace that inline image in place.
Duplicate inline entries carrying that ID are collapsed; other IDs and unrelated
text are preserved. Prior file attachments remain as history. Images created
without a stable ID are separate legacy evidence and are not matched by guessing
from their captions. Start new mockup sets with IDs on the first upload.

Avoid concurrent description edits: Linear writes have no conditional-update
guard. A failed multi-step upload can leave an attachment; retry identical inputs
to resume, then inspect the read-back before changing anything else.
