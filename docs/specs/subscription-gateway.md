# Subscription gateway specification

Status: **Validated** for the controlled failover contract; live CLIProxyAPI account health remains dependent on the runtime management key.

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

## Adapter contract

`@kor-code/gateway-adapter` is read-only toward CLIProxyAPI. It reads the sorted `/v1/models` catalogue, the management `auth-files`, `config`, `usage`, and `api-key-usage` routes when available, the configured usage database in read-only mode, and `quota-axi --json --no-credential-refresh`. Missing management routes produce an unavailable account-health view; they do not trigger writes.

`route()` filters the live catalogue against required capabilities and binds a session to the first available account in deterministic account-id order. On a pre-stream quota, rate-limit, authentication, or provider-unavailable response, `stream()` clears that affinity, refreshes account health, and retries only when the caller marks the request `idempotent: true`, on the next eligible account. A stream that has delivered any SSE frame is never replayed. Route telemetry records the account slot, retry count, failover reason, request/session IDs, and whether streaming started. Upstream bodies are bounded and redacted before errors are surfaced.

The controlled proof uses a fake upstream whose first account returns a simulated 429 before any stream frame, then marks that account quota-exhausted. The same session is routed to the second account and receives one complete stream without replaying partial output.

```text
$ pnpm gateway:quota-proof
quota-proof: session-fixture account-01 -> account-02; retries=1; streamStartedOnQuota=false; completionCalls=2
```
