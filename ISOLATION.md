# Isolation harness

Kor Code is not installed into Claude Code globally. The harness creates a disposable `CLAUDE_CONFIG_DIR` under the gitignored `.sandbox/` directory and loads the plugin only for that invocation with `--plugin-dir`.

Run it from the repository:

```sh
./scripts/sandbox.sh                # headless /kor-status proof
./scripts/sandbox.sh "/kor replay"  # any headless prompt, same guards
./scripts/sandbox.sh --interactive  # the TUI (also `pnpm cockpit`)
./scripts/sandbox.sh --live-model "…"  # opt in to model calls through CLIProxyAPI
./scripts/sandbox.sh --run claude …    # the controller's execution sessions (live)
```

The child sees nothing of the real user setup. Claude Code reads `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.mcp.json` in every ancestor of its working directory, and the real `~/.claude` is the ancestor `.claude` of anything under the home directory, so the child runs in a fresh `/tmp/kor-sandbox.*` root outside every home, with its own git root and scratch directory, deleted on exit. The harness refuses to start if that root's ancestors hold any of those files. The child starts from an empty environment: every inherited variable is unset and it gets the sandbox `HOME` and `CLAUDE_CONFIG_DIR`, a `PATH` of system directories only (so no shim directory from the invoking session, such as Codex's, is ever probed), the model endpoint variables, and only the terminal and locale variables a TUI needs. Claude Code is called by absolute path, memory-file discovery (`CLAUDE_CODE_DISABLE_CLAUDE_MDS`) and the autoupdater are off, and the harness fails closed if the binary or any sandbox directory resolves inside `~/.claude`, `~/.claude.json`, `~/.codex` or `~/.agents`. Non-essential traffic stays on because it carries the feature flags that give the cockpit its full-width pane; it goes to Anthropic, not to any local port. Onboarding and the trust prompt are marked done only in the sandbox's own `.claude.json`, for that run's working directory alone. `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes even headless runs lay the engine's API types beside the plugin (`packages/claude-plugin/.claude-plugin/types`, gitignored) for `pnpm typecheck`.

## Offline by default

A sandbox run makes no model calls unless asked to. Its `ANTHROPIC_BASE_URL` is `scripts/offline-endpoint.py`, a stub the harness serves on an ephemeral loopback port for that run alone, which answers every request with a non-retryable error naming the opt-in, and its `ANTHROPIC_AUTH_TOKEN` is a placeholder. The cockpit's views, `/kor-status` and `/kor replay` are answered by the plugin's own hooks, so they need no model; a typed prompt fails at once with `Kor sandbox is offline`. An offline run never contacts CLIProxyAPI on `127.0.0.1:8317` and never reads its key.

`--live-model` is the explicit opt-in for a session that needs model calls. It points the child at CLIProxyAPI (`KOR_GATEWAY_URL`, default `http://127.0.0.1:8317`) as a client only, the same way the Phase 4 gateway adapter uses it: nothing starts, stops or reconfigures the proxy. The key comes from `KOR_GATEWAY_KEY` or a runtime-only file named by `KOR_GATEWAY_KEY_FILE`; it is passed only through the child's environment, never on a command line, and the path is never inferred from a machine-specific location. The isolation proof below covers offline runs only and refuses `--live-model` and `--run`.

The harness never opens the real `~/.claude`, `~/.claude.json`, `~/.codex` or `~/.agents`: it compares those paths as strings only, to fail closed if anything would resolve into them. The plugin is not copied to a marketplace or installed globally. Kor Code services, when added, must use a port other than CLIProxyAPI's `8317`.

## Isolation proof

`pnpm isolation:proof` (or `scripts/isolation-proof.sh "/kor replay"` for another prompt, `--interactive` for the TUI) runs the sandbox under `strace` (on `PATH`, or `STRACE=/path/to/strace`) and records every file, process and network syscall of the child and its descendants. It fails if any of them names `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.agents` or the CLIProxyAPI tree, or connects to, binds or sends a request naming port `8317`, and it prints the loopback ports the child connected to (only the offline endpoint's). With `KOR_CLIPROXYAPI_DIR` set to the CLIProxyAPI install directory, it also hashes that directory's configuration (YAML, TOML, JSON and key files, except the `oauth/` credentials the proxy refreshes itself) before and after the run, prints only the digests, and fails if they differ.

The proof is attributed by the child's own trace, not by a before/after snapshot of the user homes. On a host where other Claude Code and Codex sessions run, those sessions keep writing `~/.claude` and `~/.codex`, so a whole-tree byte comparison changes during any run and cannot tell their writes from the sandbox's; the trace shows the sandboxed session never names those paths at all.

What the child still reads outside the sandbox, all read-only: the Claude Code binary it is launched from, this repository's plugin directory, system configuration (`/etc/gitconfig`, the shared library cache), Claude Code's machine policy (`/etc/claude-code`), and on WSL the Windows `HKLM` and `HKCU` `Software\Policies\ClaudeCode` registry values, which Claude Code queries through `reg.exe` by absolute path with no setting to turn it off. Those are administrator policy locations, not the user's Claude Code or Codex configuration.

## Controller sessions

The Phase 2 controller (`SessionLauncher` in `packages/controller`) launches each execution's Claude Code session through `scripts/sandbox.sh --run`, with the execution's worktree as the working directory. These sessions do the issue's work, so they are live clients of CLIProxyAPI (`KOR_GATEWAY_URL`, default `http://127.0.0.1:8317`, with the key from `KOR_GATEWAY_KEY` or `KOR_GATEWAY_KEY_FILE`) in the same client-only way as `--live-model`; nothing starts, stops or reconfigures the proxy. A `--run` child starts from `env -i` and gets only: a per-execution `HOME` and `CLAUDE_CONFIG_DIR` named by the launcher (`KOR_SANDBOX_HOME`, `KOR_SANDBOX_CONFIG`; the harness refuses any path outside `.sandbox/`), `CODEX_HOME` and XDG directories under that home, a fixed allowlist `PATH` (system directories plus the directory holding the `claude` binary), `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, the model endpoint variables and the `KOR_EXECUTION_ID`, `KOR_WORKTREE` and `KOR_ROUTE_MODEL` values. The launcher also passes `--bare --setting-sources ""` and the plugin directory explicitly. Unlike the cockpit's runs, a `--run` session works inside its worktree rather than a fresh root outside every home, so ancestor settings are kept out by those flags and the memory-file switch rather than by location, and the offline isolation proof does not trace it.
