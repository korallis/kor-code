# Linear integration specification

## Purpose

Linear is the command centre for intent and delivery history. Kor Code uses Linear as the only project and issue management system.

**Status: Validated** — the fake contract probe covers an issue lifecycle, one linked execution, a Linear-shaped signed webhook delivery returning HTTP 200, and duplicate suppression. The live adapter has only been exercised with read-only count checks. Mutations require explicit writer configuration and are not enabled by the probe. Phase 1 persists the `queued` → `running` → `complete` execution subset; the broader lifecycle and retry states remain controller responsibilities.

## Linear model

| Linear object | Kor Code meaning |
| --- | --- |
| Initiative | Related products or strategic goals |
| Project | One persistent application workspace |
| Document | Requirements, architecture, decisions, and rules |
| Milestone | Release or major deliverable |
| Issue | One bounded engineering assignment |
| Sub-issue | An independently executable part |
| Dependency | An ordering constraint |
| Agent session | Live Jev execution activity |
| Project update | Health, progress, blockers, and next steps |

## Issue readiness

An issue is ready when it has an owning team and project, a stated outcome, acceptance conditions, a repository or project resource, resolved blocking dependencies, enough context to start, and a policy-compatible execution path.

`kor linear lint ISSUE-ID [--json]` checks explicit acceptance criteria, completed
blocking dependencies and the `ui-screenshot` policy. The exact label `UI` is
matched after trimming whitespace and ignoring case. Other labels do not require
an image. `hasScreenshot` is true when the description or a comment embeds an
image (inline or reference Markdown, or an HTML `img`), or an attachment URL has
an image filename extension. HTTP(S) image embeds and inline `data:image/` embeds
count; ordinary links and fenced or inline code examples do not. Attachment image formats are PNG,
JPEG, GIF, WebP, AVIF, SVG, BMP, TIFF and HEIC, including URLs with query strings.
Project documents and linked web pages do not count as ticket images.

These are presence checks: lint does not download or judge the image, confirm
that it covers every affected screen, or choose a route. It uses only Linear
credentials and never writes a comment or changes an issue. Exit `0` means every
ticket check passes; exit `1` means a check failed or the request failed; exit `2`
means invalid arguments. A successful lint does not replace Jev's scope judgment
or the verified-route check.

`kor linear lint --project PROJECT-ID [--json]` checks all project issues, including
completed issues. Use the project's UUID. Projects exceeding 100 issues fail
explicitly rather than returning a partial readiness report; lint individual
issues in that case. An empty project reports no issues and exits `0`.

Both `kor plan` and daemon preflight supply labels and `hasScreenshot` to Jev,
alongside the deterministic `ui-screenshot` check. A missing image blocks a
UI-labelled ticket even if Jev answers ready, is unavailable, or a route override is active. The decision audit,
plan output and daemon blocker retain the instruction to embed or attach an image
and retry. Adding a missing image or changing the UI label updates the preflight inputs.

## Lifecycle

~~~mermaid
stateDiagram-v2
    [*] --> Queued
    Queued --> Evaluating
    Evaluating --> Blocked: missing intent or dependency
    Evaluating --> Ready: dispatch allowed
    Ready --> Running
    Running --> Waiting: external event or clarification
    Waiting --> Running
    Running --> Verifying
    Verifying --> Repairing: evidence fails
    Repairing --> Running
    Verifying --> Review: policy requires review
    Review --> Repairing: findings
    Review --> Complete: approved
    Verifying --> Complete: evidence sufficient
    Running --> Failed: unrecoverable error
    Failed --> Queued: retry allowed
    Failed --> Escalated: retry exhausted
    Complete --> [*]
~~~

## Meaningful updates

Write updates for execution changes, significant findings, blockers, failovers, test or review results, pull requests, completion, and escalation. Do not mirror every tool call.

## Webhooks

1. Validate the signature.
2. Deduplicate the event ID.
3. Acknowledge quickly.
4. Enqueue reconciliation.
5. Read current Linear state before acting.
6. Record the reconciliation result.

Treat webhook payloads as triggers, not as the complete source of truth.

Webhook event IDs and execution assignments are persisted in the Linear store's SQLite database. WAL mode and `BEGIN IMMEDIATE` make acceptance and queue insertion atomic across controller processes. A duplicate ID with a different payload digest fails closed. Execution leases contain an owner, token, expiry, and attempt count; state transitions and outbox writes commit under the same lease. A single writer lease drains the outbox, acknowledging each write only after the client succeeds.

Upstream response bodies are bounded and redacted on HTTP, transport, and GraphQL errors. The adapter validates JSON at the boundary and never exposes the credential or upstream issue text in error messages.

## Cross-project work

A change across several projects uses linked issues. Each repository gets its own branch, worktree, and verification record.
