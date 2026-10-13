# Kor Code acceptance criteria

## Linear

- Given an authorised project, Kor Code reads its issues, documents, dependencies, and sessions.
- Given two projects, repositories, context, and worktrees remain separate.
- Given a blocking dependency, the controller records the blocker and does not dispatch.
- Given a ready issue, the controller creates one traceable execution.
- Given completion, Linear contains status, evidence, and links.

## Jev

- Given a task and eligible routes, Jev returns a choice, reasons, confidence, and evidence references.
- Given low confidence, the controller gathers evidence, escalates, or asks for clarification.
- Given a hard policy failure, the controller blocks the action.
- Given a user override, the controller records it and applies it only when policy permits.

## Parallel work

- Independent issues run in isolated worktrees.
- Shared dependencies are ordered.
- A crashed worker can be reclaimed without duplicating completed work.
- Cross-project work produces linked issues and separate evidence.

## Gateway

- An available preferred account keeps session affinity.
- A pre-stream quota failure can trigger policy-defined failover.
- A partial stream is not replayed automatically.
- An incompatible model path is rejected before execution.
- An expired credential marks the account unavailable without exposing the secret.

## Verification

- Every acceptance condition has evidence or an unresolved status.
- A failing check blocks completion until repair, waiver, or escalation is recorded.
- High-risk changes receive the configured review.
- Completion links the pull request and checks.

## Cockpit

- An active execution shows project, issue, route, agents, provider state, and next action.
- A decision shows choice, confidence, reasons, and evidence references.
- Non-live values are labeled.
