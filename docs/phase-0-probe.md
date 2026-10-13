# Phase 0 probe record

Run the probes with `pnpm probe`. The command is deliberately a probe runner rather than a test suite: each external contract reports `Validated` or `Blocked` using the status vocabulary in the README.

The gateway probe reads the CLIProxyAPI model catalogue at `http://127.0.0.1:8317/v1/models`, tries catalogue routes until one produces a one-token stream, and reads quota-axi with credential refresh disabled. The Claude probe creates `.sandbox/claude-config` and `.sandbox/home`, runs the child from an empty environment in a fresh working directory outside every home (see [ISOLATION.md](../ISOLATION.md)), loads `packages/claude-plugin` with `--plugin-dir`, requires the exact `/kor-status` text that the plugin's own hook returns (no model involved), and compares only configuration-surface checksums before and after; its timeout is 120 s (`KOR_SANDBOX_TIMEOUT_MS`). The Jev probe sends one Choice request to `https://api.typesafe.ai/v1/systemone` with model `jev-1.13.0`. The Linear probe is read-only: it queries the viewer, teams, and workflow states and never writes an issue or session. It prints only whether the viewer resolved and the team and workflow-state counts, never an identity.

## Latest local run

| Probe | Status | Evidence |
| --- | --- | --- |
| Gateway catalogue and stream | Validated | Runtime-key probe listed `devin/gpt-5-6-sol`, `devin/deepseek-v4-pro`, and `grok-4.7-build-fast`, selected `devin/gpt-5-6-sol`, streamed `ready`, and reported the read-only management API as unavailable. |
| Claude Code plugin isolation | Validated | With `HOME` and `CLAUDE_CONFIG_DIR` under `.sandbox/` and the working directory outside every home, the cockpit plugin answered `/kor-status` from its own hook; the proof text appeared and the configuration-surface checksum was unchanged. |
| Jev Choice | Validated | Choice returned `foundation` with confidence `0.96` using model `jev-1.13.0`. |
| Linear read-only contract | Validated | Read-only viewer, team, and workflow-state query uses the runtime `LINEAR_API_KEY` from the environment or `~/.config/linear/env`; output is limited to counts. |

Blocked rows are expected when the external credential or service is unavailable. No credential is committed or copied into the repository.
