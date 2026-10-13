# Isolation harness

Kor Code is not installed into Claude Code globally. The harness creates a disposable `CLAUDE_CONFIG_DIR` under the gitignored `.sandbox/` directory and loads the plugin only for that invocation with `--plugin-dir`.

Run it from the repository:

```sh
./scripts/sandbox.sh
```

The command uses `HOME` and `CLAUDE_CONFIG_DIR` rooted under `.sandbox/`, passes the gateway only to the child process through `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, invokes the harmless `/kor-status` command, and never resolves the real Claude home from the sandbox process. The harness compares only plugin and settings surfaces before and after: Claude settings, credentials, `CLAUDE.md`, keybindings, plugin/skill/hook/agent/command trees, and the `mcpServers` key in `~/.claude.json`; session and transcript churn is excluded. Volatile plugin cache `.in_use` markers and marketplace `lastUpdated` fields are excluded, while malformed configuration fails closed. A successful run requires the `/kor-status` proof text and a stable configuration checksum. The plugin is not copied to a marketplace or installed globally. Kor Code services, when added, must use a port other than CLIProxyAPI's `8317`.
