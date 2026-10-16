---
name: using-linear
description: Reads and updates Linear data. Use when reading issues, changing project records, linking work or reporting ticket progress.
license: MIT
metadata:
  kor.kind: skill
  kor.stages: plan,execute,repair,review,ship,project-setup
  kor.triggers: read Linear issue; update Linear project; report ticket progress; upload issue image
  kor.anti: drafting or splitting ticket content; implementing code without tracker changes
  kor.requires: Bash
  kor.visibility: public
  kor.budget: "1300"
---

# Using Linear

Use only discovered MCP tools, verified CLI commands or the documented GraphQL
API. Kor provides `kor linear attach-image`; describe other unavailable operations
as API/MCP intentions with field values, rather than inventing executable commands.

1. **Read before writing.** Resolve the issue identifier to its stable ID. Read
   its description, comments, attachments, parent, dependencies, project and team
   guidance. Search for existing work before creating anything. Inspect the team's
   available states, labels and members rather than inventing their names or IDs.
2. **Bound the change.** Match the requested outcome to an existing issue or
   project. Keep one accountable assignee; delegation to an agent and assignment
   to a person are distinct operations. Preserve ownership unless a transfer is
   requested. Link dependencies with blocking relations, children with parent
   relations, and related work without implying a block. Creating or splitting
   ticket content calls for the writing-linear-tickets skill.
3. **Choose the record.** Put current scope and acceptance in the description;
   put progress, evidence, decisions and blockers in comments. Put shared project
   context in project documents and link it from relevant issues. Preserve useful
   existing text when refining scope. A change of outcome needs an explicit scope
   decision, recorded before execution. Use the workspace priority scale and
   existing labels; urgency needs a concrete reason.
4. **Write the smallest change.** Group independent reads; apply dependent writes
   in order and keep batches small enough to verify. When a write times out, read
   back before retrying a create. Use the returned IDs in subsequent operations.
   Kor already owns execution-state transitions and stable progress comments:
   supplement them with missing evidence rather than duplicating them.
5. **Verify.** Read changed records back and compare every intended field, link,
   relation and image. Report the issue link, what changed, verification performed
   and any remaining blocker. A successful API call alone is incomplete evidence.

## Kor workflow

Use the repository's configured workflow mapping. Kor starts opted-in Todo work,
sets In Progress on execution, and uses In Review when completion includes a PR
and a review state is configured; otherwise it uses the configured completed
state. State names differ by team. Confirm policy before moving work to Done;
a PR link does not prove it was merged. With `ship: merge`, Kor merges only after
independent review, passing GitHub checks and a Jev merge decision at or above
0.90. With `ship: auto` or `ship: approve`, the owner merges.

Readiness means explicit, checkable acceptance, resolved product decisions and
completed dependencies. A plan without live access names proposed changes and
required discovery; it does not invent team settings or claim a successful write. UI
work also needs captioned images for every affected screen and state. Report
missing context as a blocker with the exact information needed; preserve the
issue's scope while it is unresolved. Never put credentials or private runtime
configuration in tracker content.

## Tool branches

- With a connected Linear MCP, follow [MCP operations](references/mcp-tools.md)
  to discover the available tools and read back each mutation.
- With the API, use authenticated GraphQL from the host. Resolve credentials at
  runtime; provide them through request headers, never command arguments or logs.
  Keep credentials out of execution-session prompts and attachments.
- For PNG screenshots, execute `kor linear attach-image ISSUE FILE --alt CAPTION --screen SCREEN-ID`.
  Read [image handling](references/images.md) before uploading or inspecting
  private assets. Caption each image with its route and state.

Complete only when the readback matches the requested change. If a partial
write remains, report which record exists and what still needs repair.
