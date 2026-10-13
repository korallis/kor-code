# Linear integration specification

## Purpose

Linear is the command centre for intent and delivery history. Kor Code uses Linear as the only project and issue management system.

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

## Cross-project work

A change across several projects uses linked issues. Each repository gets its own branch, worktree, and verification record.
