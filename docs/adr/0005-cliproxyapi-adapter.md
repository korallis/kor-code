# ADR 0005: Adapt the existing CLIProxyAPI

- Status: accepted
- Date: 2026-10-13

## Context

CLIProxyAPI already runs the provider catalogue, account pool, credentials, quota routing, and streaming endpoint on `127.0.0.1:8317`. Starting a second gateway would duplicate those responsibilities and could interfere with the user's existing Claude Code setup.

## Decision

Kor Code uses a thin, read-only gateway adapter over the existing CLIProxyAPI. It reads `/v1/models`, the documented `/v0/management/*` endpoints when a management key is available, and `quota-axi` output. It does not open CLIProxyAPI's live usage database because SQLite WAL reads can create sidecar files. Kor Code does not start, reconfigure, or replace CLIProxyAPI. Any future Kor-owned service uses a separate port.

## Consequences

Provider and account facts remain consistent with the user's active proxy. Management data can be unavailable when CLIProxyAPI access is disabled or its management key is absent; the adapter reports that state instead of writing configuration. Usage facts come from `quota-axi`, so the adapter never creates SQLite WAL sidecar files in the proxy directory. Compatibility probes must account for stale or unavailable catalogue routes.
