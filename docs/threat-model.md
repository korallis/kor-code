# Kor Code threat model

## Assets

Provider credentials, repository source, Linear documents, GitHub access, Jev prompts, decisions, audit records, and worktrees.

## Trust boundaries

~~~mermaid
flowchart LR
    U[User] --> L[Linear]
    L --> K[Kor controller]
    K --> J[Jev service]
    K --> R[Claude Code runtime]
    R --> G[Provider gateway]
    R --> H[GitHub]
    K --> A[Audit store]
~~~

## Threats and controls

| Threat | Control |
| --- | --- |
| A prompt includes a token | Redact secrets before requests and logs |
| An issue asks for a destructive command | Deterministic command and policy guards |
| Two workers edit one checkout | Per-execution worktrees and leases |
| Webhook replay creates work | Signature validation and deduplication |
| A provider repeats partial output | No automatic replay after stream start |
| Jev gives a weak recommendation | Confidence thresholds and evidence gathering |
| A model mishandles tools | Capability and end-to-end compatibility tests |
| UI implies stale data is live | Explicit state labels |
| Restart loses ownership | Durable records and reconciliation |
| PR links to the wrong issue | Verify issue, branch, and PR identity |

## Security rules

- Keep credentials in the gateway or secret manager.
- Never commit provider credentials.
- Redact secrets from Jev input, Linear comments, and audit records.
- Scope Linear and GitHub tokens to the smallest required permissions.
- Keep destructive operations behind deterministic policy.
