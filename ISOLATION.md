# Isolation harness

Kor Code is not installed into Claude Code globally. The harness creates a disposable `CLAUDE_CONFIG_DIR` under the gitignored `.sandbox/` directory and loads the plugin only for that invocation with `--plugin-dir`.

Run it from the repository:

```sh
./scripts/sandbox.sh                # headless /kor-status proof
./scripts/sandbox.sh "/kor replay"  # any headless prompt, same guards
./scripts/sandbox.sh --interactive  # the TUI (also `pnpm cockpit`)
```

The child sees nothing of the real user setup. Claude Code reads `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.mcp.json` in every ancestor of its working directory, and the real `~/.claude` is the ancestor `.claude` of anything under the home directory, so the child runs in a fresh `/tmp/kor-sandbox.*` root outside every home, with its own git root and scratch directory, deleted on exit. The harness refuses to start if that root's ancestors hold any of those files. The child starts from an empty environment: every inherited variable is unset and it gets the sandbox `HOME` and `CLAUDE_CONFIG_DIR`, a `PATH` of system directories only (so no shim directory from the invoking session, such as Codex's, is ever probed), the gateway variables, and only the terminal and locale variables a TUI needs. Claude Code is called by absolute path, memory-file discovery (`CLAUDE_CODE_DISABLE_CLAUDE_MDS`) and the autoupdater are off, and the harness fails closed if the binary or any sandbox directory resolves inside `~/.claude`, `~/.claude.json`, `~/.codex` or `~/.agents`. Non-essential traffic stays on because it carries the feature flags that give the cockpit its full-width pane. Onboarding and the trust prompt are marked done only in the sandbox's own `.claude.json`, for that run's working directory alone. `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes even headless runs lay the engine's API types beside the plugin (`packages/claude-plugin/.claude-plugin/types`, gitignored) for `pnpm typecheck`.

The command uses `HOME` and `CLAUDE_CONFIG_DIR` rooted under `.sandbox/`, passes the gateway only to the child process through `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, invokes the harmless `/kor-status` command (answered by the plugin's own hook, never by the model), and never resolves the real Claude home from the sandbox process. The harness compares only plugin and settings surfaces before and after: Claude settings, credentials, `CLAUDE.md`, keybindings, plugin/skill/hook/agent/command trees, and the `mcpServers` key in `~/.claude.json`; session and transcript churn is excluded. Volatile plugin cache `.in_use` markers and marketplace `lastUpdated` fields are excluded, while malformed configuration fails closed. A successful run requires a stable configuration checksum and, for `/kor-status`, its exact proof text. The plugin is not copied to a marketplace or installed globally. Kor Code services, when added, must use a port other than CLIProxyAPI's `8317`.

## Isolation proof

`pnpm isolation:proof` (or `scripts/isolation-proof.sh "/kor replay"` for another prompt, `--interactive` for the TUI) runs the sandbox under `strace` (on `PATH`, or `STRACE=/path/to/strace`) and records every file, process and socket syscall of the child and its descendants. It fails if any of them names `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` or the CLIProxyAPI tree. The trace covers only the child, so it is the proof to rely on while other Claude Code or Codex sessions run on the same host: they keep writing those homes, so a before/after byte snapshot of the whole trees cannot tell their writes from the sandbox's.

What the child still reads outside the sandbox, all read-only: the Claude Code binary it is launched from, this repository's plugin directory, system configuration (`/etc/gitconfig`, the shared library cache), Claude Code's machine policy (`/etc/claude-code`), and on WSL the Windows `HKLM` and `HKCU` `Software\Policies\ClaudeCode` registry values, which Claude Code queries through `reg.exe` by absolute path with no setting to turn it off. Those are administrator policy locations, not the user's Claude Code or Codex configuration.
