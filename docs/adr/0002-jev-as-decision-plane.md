# ADR 0002: Make Jev the decision plane

- Status: accepted
- Date: 2026-10-13

## Context

The system must choose models, agents, skills, context, verification, and escalation. Asking a coding model to make every operational choice makes policy inconsistent and decisions hard to audit.

## Decision

Use Jev for structured decisions. Keep execution in Claude Code or another runtime. Use ordinary software and external tools for facts and hard guarantees.

## Consequences

Decisions become typed and auditable. Jev needs a fallback path, focused evidence, and calibration. Jev does not generate application code.
