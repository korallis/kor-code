#!/usr/bin/env bash
# Claude plugin subcommands can migrate user settings, even during validation.
set -euo pipefail

plugin_dir=$(realpath "${1:-.}")
claude_bin=$(command -v claude) || { echo 'Plugin validation requires Claude Code on PATH.' >&2; exit 1; }
claude_bin=$(realpath "$claude_bin")
validation_root=$(mktemp -d /tmp/kor-plugin-validation.XXXXXX)
trap 'rm -rf -- "$validation_root"' EXIT
mkdir -p "$validation_root/home" "$validation_root/claude" "$validation_root/tmp"
# Keep both configuration lookup and ancestor discovery outside the caller's home.
cd "$validation_root"
env -i \
  HOME="$validation_root/home" CLAUDE_CONFIG_DIR="$validation_root/claude" \
  XDG_CONFIG_HOME="$validation_root/home/.config" XDG_STATE_HOME="$validation_root/home/.local/state" \
  XDG_DATA_HOME="$validation_root/home/.local/share" TMPDIR="$validation_root/tmp" \
  PATH=/usr/local/bin:/usr/bin:/bin DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 \
  ANTHROPIC_BASE_URL=http://127.0.0.1:1 ANTHROPIC_AUTH_TOKEN=offline-validation \
  "$claude_bin" plugin validate "$plugin_dir"
