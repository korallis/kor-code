# Phase 0 probe record

Run the probes with `pnpm probe`. The command is deliberately a probe runner rather than a test suite: each external contract reports `Validated` or `Blocked` using the status vocabulary in the README.

The gateway probe reads the CLIProxyAPI model catalogue at `http://127.0.0.1:8317/v1/models`, tries catalogue routes until one produces a one-token stream, and reads quota-axi with credential refresh disabled. The Claude probe creates `.sandbox/claude-config` and `.sandbox/home`, loads `packages/claude-plugin` with `--plugin-dir`, requires `/kor-status` proof text, and compares only configuration-surface checksums before and after. The Jev probe sends one Choice request to `https://api.typesafe.ai/v1/systemone` with model `jev-1.13.0`. The Linear probe is read-only: it queries the viewer, teams, and workflow states and never writes an issue or session.

## Latest local run

| Probe | Status | Evidence |
| --- | --- | --- |
| Gateway catalogue and stream | Validated | Runtime-key probe listed `grok-imagine-image-2.0`, `grok-imagine-video-1.5-preview`, and `claude-fable-5`, selected `claude-fable-5`, and streamed `ready`. |
| Claude Code plugin isolation | Validated | With `HOME` and `CLAUDE_CONFIG_DIR` under `.sandbox/`, Claude Code expanded `kor-code-cockpit:kor-status`; the proof text appeared and configuration-surface checksum was unchanged. |
| Jev Choice | Validated | Choice returned `foundation` with confidence `0.96` using model `jev-1.13.0`. |
| Linear read-only contract | Validated | Read-only viewer, team, and workflow-state query uses the runtime `LINEAR_API_KEY` from the environment or `~/.config/linear/env`. |

Blocked rows are expected when the external credential or service is unavailable. No credential is committed or copied into the repository.
