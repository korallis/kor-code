# Isolation harness

Kor Code is not installed into Claude Code globally. The harness creates a disposable `CLAUDE_CONFIG_DIR` under the gitignored `.sandbox/` directory and loads the plugin only for that invocation with `--plugin-dir`.

Run it from the repository:

```sh
./scripts/sandbox.sh
```

The command uses `claude -p` with `--no-session-persistence`, invokes the harmless `/kor-status` command, and never writes `~/.claude`. The harness compares a checksum of `~/.claude` before and after the run. The plugin is not copied to a marketplace or installed globally. Kor Code services, when added, must use a port other than CLIProxyAPI's `8317`.
