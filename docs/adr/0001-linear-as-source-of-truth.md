# ADR 0001: Use Linear as the source of truth

- Status: accepted
- Date: 2026-10-13

## Context

Kor Code needs one durable place for projects, issues, requirements, dependencies, progress, and delivery history. A second project database would duplicate intent.

## Decision

Use Linear as the only project and issue management system. Runtime state may exist in the controller, but it must link to a Linear issue and must not become a second backlog.

## Consequences

Every substantive execution has a Linear issue. Cross-project work uses linked issues. The controller must reconcile runtime state with Linear after restarts. Linear API limits become integration constraints.
