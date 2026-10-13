# Phase 0 probe record

Run the probes with `pnpm probe`. The command is deliberately a probe runner rather than a test suite: each external contract reports `Validated` or `Blocked` using the status vocabulary in the README.

The gateway probe reads the CLIProxyAPI model catalogue at `http://127.0.0.1:8317/v1/models`, requests one streamed completion, and reads quota-axi with credential refresh disabled. The Claude probe creates `.sandbox/claude-config`, loads `packages/claude-plugin` with `--plugin-dir`, and compares a checksum of `~/.claude` before and after. The Jev probe sends one Choice request to `https://api.typesafe.ai/v1/systemone` with model `jev-1.13.0`. The Linear probe is read-only: it queries the viewer, teams, and workflow states and never writes an issue or session.

## Latest local run

| Probe | Status | Evidence |
| --- | --- | --- |
| Gateway catalogue and stream | Blocked | CLIProxyAPI returned HTTP 401 from `/v1/models` in this environment. |
| Claude Code plugin isolation | Blocked | Claude Code 2.1.296 reported `Not logged in`; the harness exited before invoking the command and did not change `~/.claude`. |
| Jev Choice | Validated | Choice returned `foundation` with confidence `0.96` using model `jev-1.13.0`. |
| Linear read-only contract | Validated | Read-only viewer, team, and workflow-state query uses the runtime `LINEAR_API_KEY` from the environment or `~/.config/linear/env`. |

Blocked rows are expected when the external credential or service is unavailable. No credential is committed or copied into the repository.
