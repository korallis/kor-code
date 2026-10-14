# ADR 0006: Build the cockpit as a session-local Claude Code mod

- Status: accepted
- Date: 2026-10-13

## Context

The cockpit must sit inside the Claude Code sessions Kor Code runs, start from one tested visual layer, and never interfere with the user's own Claude Code setup. Claude Code 2.1.296 loads plugins of function hooks ("mods"): one TypeScript module that can pin a status line, register slash commands that answer themselves, and draw panes, all without a model call. The earlier proof command was a Markdown command whose output depended on the model echoing it.

## Decision

The cockpit is one hooks module in `packages/claude-plugin`, loaded only with `--plugin-dir` inside `scripts/sandbox.sh` (a throwaway `CLAUDE_CONFIG_DIR` and `HOME`, an empty environment with a system-only `PATH`, memory files off, and a working directory outside every home so no ancestor `CLAUDE.md`, `.claude/` or `.mcp.json` is read). Sandbox runs are offline by default: the child's model endpoint is a stub on an ephemeral loopback port, so the cockpit never contacts CLIProxyAPI; `--live-model` is the explicit opt-in that makes the child a client of CLIProxyAPI for model calls. It is never installed globally or into a marketplace. Its commands answer from the plugin's own `command.run` hook, so `/kor-status` and every view are deterministic. Every row carries its provenance label, mirroring core's `Provenance` type. The data is the Kor daemon's status, read through `$` (loopback HTTP on port 8327, then the daemon's snapshot files); the fixture execution in `hooks/fixture.ts` stays behind `/kor demo`. Overrides are posted to the daemon, which owns the policy check, the audit and the Linear comment; the mod itself writes nothing.

## Consequences

The cockpit needs no settings change or model call and never uses port 8317; without a running daemon it draws every daemon value UNAVAILABLE (or STALE from the last snapshot) rather than inventing one; the offline endpoint lives only for one sandbox run. The API is early access, so the module is validated with `claude plugin validate` and type-checked against the types the engine lays beside it (`.claude-plugin/types`, gitignored), and must be re-checked when Claude Code updates. `pnpm isolation:proof` traces the child's syscalls to prove it never touches the real Claude, Codex or agents homes or port 8317, and, only when `KOR_CLIPROXYAPI_DIR` names the CLIProxyAPI install directory, checks that its configuration digest is unchanged; without it the proof rests on the trace alone. The controller's `--run` sessions are live CLIProxyAPI clients by design and are outside this proof (see ISOLATION.md). A hooks module imports only files inside its plugin, so the daemon's status reaches it through `$.http.fetch` and `$.fs.read`, and `hooks/live.ts` checks the payload by hand rather than with core's types. Amended 2026-10-14 (T8): live data and daemon-side overrides replaced the fixture-only cockpit.
