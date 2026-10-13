# ADR 0004: Keep provider routing behind a gateway

- Status: accepted
- Date: 2026-10-13

## Context

The subscription pool has several provider families and account slots. Model selection and account selection are different decisions. Credentials and quota logic should not spread across Jev and Claude Code.

## Decision

Use a gateway boundary for credentials, account health, quota state, session affinity, safe retries, and provider failover. In the foundation, that boundary is a thin read-only adapter over the existing CLIProxyAPI, as recorded in ADR 0005. Jev selects the model family and route policy. The gateway selects an eligible account.

## Consequences

Credentials stay out of the decision core. The gateway must expose accurate capability and quota facts. Non-Claude paths require end-to-end tests. Cache locality and partial streams constrain failover.
