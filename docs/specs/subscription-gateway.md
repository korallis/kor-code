# Subscription gateway specification

## Purpose

The gateway provides one compatible endpoint for the account pool while keeping credentials and quota state outside Jev's decision logic.

## Provider catalogue

~~~yaml
provider: claude
model: sonnet
capabilities:
  streaming: true
  tool_calls: true
  thinking: true
  structured_output: true
account_slots:
  - claude-01
  - claude-02
availability: available
compatibility: verified
~~~

A model is eligible only when its capabilities match the requested execution.

## Account policy

~~~yaml
strategy: fill-first
session_affinity: true
session_affinity_ttl: 1h
session_affinity_subagents: true
rebind_on:
  - quota
  - authentication
  - provider_unavailable
~~~

Fill-first keeps the preferred account until a configured condition makes it unavailable.

## Failover

Fail over on quota or rate-limit response, invalid credentials, provider unavailability, or a capability failure before output starts.

Do not replay a request after partial streamed output unless the operation is explicitly idempotent and the runtime can reconcile the result.

## Boundary

| Question | Owner |
| --- | --- |
| Which model family fits the task? | Jev |
| Which account can serve the model? | Gateway |
| Is switching worth losing cache locality? | Jev with gateway facts |
| Has an account exhausted quota? | Gateway |
| Should execution retry? | Controller policy plus Jev |
| Can this model support the runtime contract? | Compatibility checks |

## Telemetry

Record provider, model, account slot, session ID, request ID, decision ID, failover reason, retry count, stream state, quota response, and compatibility result.

Never record access tokens, refresh tokens, or raw secret values.
