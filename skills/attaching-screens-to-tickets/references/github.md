# GitHub issue images

Use repository-hosted PNGs pinned to a full commit SHA. GitHub has no documented
REST endpoint for the web UI's issue asset upload. A local path or a mutable branch
URL is insufficient evidence. Keep sensitive mockups in the same private
repository; access belongs to its readers. A public asset repository needs explicit
publication permission. Never upload private screens there as a workaround.

1. Inspect every PNG and its stable inventory ID. Commit approved public-safe
   mockups under `docs/mockups/` in the target repository and push an authorised
   branch. A planning branch is enough; a merge is unnecessary. Preserve the
   commit while issues reference it. Record the full SHA and relative file path.
2. Run the bundled script from its installed location (resolve the path beside
   this skill's `SKILL.md`). It uses authenticated `gh-axi api` and changes only
   the keyed inline image in the issue body; prior commits retain image history.

```sh
node /path/to/attaching-screens-to-tickets/scripts/attach-github-image.mjs \
  OWNER/REPO#123 docs/mockups/saved-empty-phone.png \
  --ref FULL_40_CHARACTER_COMMIT_SHA --path docs/mockups/saved-empty-phone.png \
  --screen saved-empty-phone --alt '/saved | empty | phone 390x844 | REQ-001'
```

The script accepts PNGs up to 1 MiB (the Contents API's inline-content limit).
For larger captures, optimise losslessly or use an approved authenticated image
host and manually perform the same keyed replacement and byte verification.
If neither is available, report attachment blocked; never silently drop a row.

3. `verified: true` means the read-back issue body and authenticated repository
   bytes match the supplied PNG. Repeat identical inputs to confirm `changed:
   false`; refreshing bytes/caption reuses the same `--screen` ID. Duplicate keyed
   image lines are collapsed, fenced examples and unrelated content preserved.
4. Open the issue in the authorised browser and inspect every rendered image at
   its intended viewport; API byte verification cannot establish visual meaning
   or browser access. Download the committed file through authenticated API access
   when private URLs cannot be fetched anonymously. Record SHA-256 and issue URL
   in INDEX only after visual inspection; keep unresolved access gaps visible.

Run serially per issue. A pre-write reread catches observed edits; GitHub issue
body updates do not provide an atomic compare-and-swap here. Coordinate with
other editors. After an uncertain write, read back and retry the same inputs.
This command does not upload new files, change ownership, add Project items or
mark issues ready. Those are separate authorised steps.
