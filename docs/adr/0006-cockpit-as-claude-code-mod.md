# ADR 0006: Build the cockpit as a session-local Claude Code mod

- Status: accepted
- Date: 2026-10-13

## Context

The cockpit must sit inside the Claude Code sessions Kor Code runs, start from one tested visual layer, and never interfere with the user's own Claude Code setup. Claude Code 2.1.296 loads plugins of function hooks ("mods"): one TypeScript module that can pin a status line, register slash commands that answer themselves, and draw panes, all without a model call. The earlier proof command was a Markdown command whose output depended on the model echoing it.

## Decision

The cockpit is one hooks module in `packages/claude-plugin`, loaded only with `--plugin-dir` inside `scripts/sandbox.sh` (a throwaway `CLAUDE_CONFIG_DIR` and `HOME`, an empty environment with a system-only `PATH`, memory files off, and a working directory outside every home so no ancestor `CLAUDE.md`, `.claude/` or `.mcp.json` is read). Sandbox runs are offline by default: the child's model endpoint is a stub on an ephemeral loopback port, so the cockpit never contacts CLIProxyAPI; `--live-model` is the explicit opt-in that makes the child a client of CLIProxyAPI for model calls. It is never installed globally or into a marketplace. Its commands answer from the plugin's own `command.run` hook, so `/kor-status` and every view are deterministic. Every row carries its provenance label, mirroring core's `Provenance` type; until Phases 1-5 feed it, the data is a fixture execution in `hooks/fixture.ts`.

## Consequences

The cockpit needs no Kor service, settings change or model call, and never uses port 8317; the offline endpoint lives only for one sandbox run. The API is early access, so the module is validated with `claude plugin validate` and type-checked against the types the engine lays beside it (`.claude-plugin/types`, gitignored), and must be re-checked when Claude Code updates. `pnpm isolation:proof` traces the child's syscalls to prove it never touches the real Claude, Codex or agents homes or port 8317, and checks the CLIProxyAPI configuration digest is unchanged. Live adapters will hand the cockpit `Labelled` values; a hooks module imports only files inside its plugin, so their data must reach it through `$` (files, processes or HTTP) rather than imports.
