# Projects v2 setup and readback

## Contents

- [Discover and create](#discover-and-create)
- [Fields, repository and documents](#fields-repository-and-documents)
- [Issues, milestones and relations](#issues-milestones-and-relations)
- [Project membership, values and order](#project-membership-values-and-order)

Use `gh-axi project --help` and `gh-axi api --help` on the installed version.
Resolve permissions before mutations: repository issue/content writes and Project
writes are separate. A personal token needs access to the repository and Project;
OAuth tokens commonly need `repo` and `project`. Report missing access without
changing credentials. Discover the authenticated owner type with `gh-axi api
/users/OWNER`: `User` and `Organization` use different GraphQL root fields.

## Discover and create

Search existing repositories, Projects, labels, milestones and issues first.
`gh-axi project list --owner OWNER` and `field-list NUMBER --owner OWNER` list
records. Follow pagination: GraphQL `pageInfo { hasNextPage endCursor }` with
`after`, REST `--paginate`. Default limits are not complete inventories.

When authorised and absent:

```sh
gh-axi project create --owner OWNER --title 'Project title'
gh-axi project view NUMBER --owner OWNER
gh-axi project field-list NUMBER --owner OWNER
```

For GraphQL send a JSON file containing `query` and `variables`:

```sh
gh-axi api POST graphql --input /tmp/project-operation.json --full
```

Use structured JSON generation, not interpolated shell strings. Read the result's
`errors` as well as `data`: GraphQL can return partial data with HTTP success.
For scripts requiring lossless data, `--jq '@base64' --full` returns a base64 JSON
scalar under gh-axi's `api_response.body` envelope (the attachment script shows
how to decode it). Keep credentials in gh-axi's runtime authentication.

Resolve the Project node ID, repository node ID and fields, adapting owner type:

```graphql
query($owner: String!, $number: Int!, $repo: String!, $after: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      id number url
      fields(first: 100, after: $after) {
        nodes {
          ... on ProjectV2FieldCommon { id name }
          ... on ProjectV2SingleSelectField { options { id name color description } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  repository(owner: $owner, name: $repo) { id url }
}
```

For organisations replace `user` with `organization`. Repository owner may differ
from Project owner; use a separate variable in that case.

## Fields, repository and documents

Reuse Status and its actual option IDs. A new board commonly starts with Todo,
In Progress and Done; do not assume Backlog or In Review exists. Agree workflow
names/mapping before changing an existing board. `updateProjectV2Field` with
`singleSelectOptions` replaces the option set: preserve **all** existing IDs,
names, colours and descriptions and add only agreed options. Read back field
options and existing item values afterwards. Never rebuild Status just to get
convenient IDs.

When absent, use `createProjectV2Field(input: $input)` with these inputs:

```json
{"projectId":"PROJECT_NODE_ID","dataType":"NUMBER","name":"Order"}
```

```json
{"projectId":"PROJECT_NODE_ID","dataType":"SINGLE_SELECT","name":"Priority","singleSelectOptions":[{"name":"High","color":"RED","description":"Agreed urgent work"},{"name":"Normal","color":"BLUE","description":"Normal delivery"}]}
```

Declare `$input: CreateProjectV2FieldInput!`; request returned field ID/name and
option IDs through the appropriate `ProjectV2Field`/`ProjectV2SingleSelectField`
fragments. Priority meanings come from the owner; these options are an example.
Use `linkProjectV2ToRepository(input: {projectId: ..., repositoryId: ...})` and
verify the Project's repositories connection. Link the full documentation set
and screen inventory in the Project README via `gh-axi project edit NUMBER
--owner OWNER --readme '...'`; preserve existing prose. Pin docs links to the
published planning commit until merged. Projects v2 has a README, not Linear's
project-document API; keep authoritative files in the repository.

## Issues, milestones and relations

Use verified `gh-axi issue`/`label` commands or REST with JSON request files:

| Operation | API |
| --- | --- |
| Create milestone | `POST /repos/OWNER/REPO/milestones` with `title`, `description` and optional agreed `due_on` |
| Create label | `POST /repos/OWNER/REPO/labels` with `name`, hex `color`, `description` |
| Create issue | `POST /repos/OWNER/REPO/issues` with `title`, `body`, existing `labels`, milestone **number**, authorised `assignees` |


Use GraphQL node IDs for native relations (these operations were exercised in
the live proof):

```graphql
mutation($input: AddSubIssueInput!) {
  addSubIssue(input: $input) { issue { id } subIssue { id } }
}
# input: {issueId: PARENT_NODE_ID, subIssueId: CHILD_NODE_ID}
```

```graphql
mutation($input: AddBlockedByInput!) {
  addBlockedBy(input: $input) { issue { id } }
}
# input: {issueId: BLOCKED_NODE_ID, blockingIssueId: PREREQUISITE_NODE_ID}
```

Verify with `GET /repos/OWNER/REPO/issues/PARENT/sub_issues` and
`GET /repos/OWNER/REPO/issues/BLOCKED/dependencies/blocked_by`; inspect both
blocking directions. Parent/child is decomposition, not dependency. Avoid cycles.
If the host/token does not support relations, preserve full links and task lists
in the bodies and record the missing enforcement; keep prerequisites gated out
of intake. Do not downgrade authentication errors into a claim of unsupported
functionality. Request the missing access when necessary.

## Project membership, values and order

Add each real issue with `gh-axi project item-add NUMBER --owner OWNER --url
ISSUE_URL`. Draft Project items lack repository issue identity and do not replace
Kor tickets. Reuse existing items; read back `items`/`fieldValues`, paginating both.

Set a single-select with discovered IDs:

```sh
gh-axi project item-edit --id ITEM_NODE_ID --project-id PROJECT_NODE_ID \
  --field-id STATUS_FIELD_ID --single-select-option-id PLANNING_OPTION_ID
```

Use the same operation for Priority; numeric Order uses `--number 1`. To reorder
visually, use `updateProjectV2ItemPosition(input: {projectId: ..., itemId: ...,
afterId: ...})`; omit `afterId` for first. Numeric Order is explicit delivery order;
board sorting can override visual position. Neither enforces blockers.

Read back issue body/images, labels, milestone, Project membership, every field
value and relations. Only then add the configured intake label and ready Status
for dependency-complete issues. Keep parent trackers, unresolved questions and
missing images in planning. Record all IDs/URLs in `docs/implementation-plan.md`
and screen-to-issue mappings in INDEX so a later run can resume without duplicates.
