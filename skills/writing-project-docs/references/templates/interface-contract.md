# Interface contract

Use docs/cli-contract.md for a CLI, docs/api-contract.md for a service API, or both
when both exist. For a project with neither, use docs/api-contract.md to record N/A
and the reason; distinguish an internal interface from a public API.

## Status and consumers

State whether this is a proposal or an implemented interface. Identify callers,
access requirements and requirement IDs. If N/A, stop after its justification.

## Operations

| Operation or command | Input and validation | Success result | Failure result | Side effects |
| --- | --- | --- | --- | --- |
| Named operation | Fields/arguments and constraints | Output shape or exit code | Error shape/status or exit code | Data changed and retry implications |

## Guarantees

Describe authentication, permissions, compatibility, limits and retry behaviour
where applicable. Unknowns need question IDs, owners and proposed defaults.

## Examples and verification

Use public-safe synthetic requests. Label examples illustrative unless observed.
Record real command or request results separately from intended behaviour.
