#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
sandbox_dir="$repo_root/.sandbox"
config_dir="${KOR_SANDBOX_CONFIG:-$sandbox_dir/claude-config}"
home_dir="${KOR_SANDBOX_HOME:-$sandbox_dir/home}"
mkdir -p "$config_dir" "$home_dir"

gateway_key="${KOR_GATEWAY_KEY:-}"
gateway_key_file="${KOR_GATEWAY_KEY_FILE:-}"
if [ -z "$gateway_key" ] && [ -n "$gateway_key_file" ]; then
  if [ ! -r "$gateway_key_file" ]; then
    echo "KOR_GATEWAY_KEY_FILE is not readable" >&2
    exit 1
  fi
  gateway_key=$(cat "$gateway_key_file")
if [ "${1:-}" = "--run" ]; then
  shift
  if [ "$#" -eq 0 ]; then echo "sandbox --run requires a command" >&2; exit 2; fi
  safe_path="${KOR_SANDBOX_PATH:-/usr/local/bin:/usr/bin:/bin}"
  tool_bin_dir="${KOR_CLAUDE_BIN_DIR:-}"
  if [ -n "$tool_bin_dir" ]; then safe_path="$tool_bin_dir:$safe_path"; fi
  env -i \
    HOME="$home_dir" CLAUDE_CONFIG_DIR="$config_dir" \
    CODEX_HOME="$home_dir/.codex" XDG_CONFIG_HOME="$home_dir/.config" XDG_DATA_HOME="$home_dir/.local/share" \
    PATH="$safe_path" \
    CLAUDE_CODE_DISABLE_CLAUDE_MDS="1" \
    ANTHROPIC_BASE_URL="http://127.0.0.1:8317" \
    ANTHROPIC_AUTH_TOKEN="$gateway_key" \
    KOR_EXECUTION_ID="${KOR_EXECUTION_ID:-}" KOR_WORKTREE="${KOR_WORKTREE:-}" \
    KOR_ROUTE_MODEL="${KOR_ROUTE_MODEL:-}" "$@"
  exit $?
fi

gateway_key="${KOR_GATEWAY_KEY:-}"

set +e
output=$(HOME="$home_dir" CLAUDE_CONFIG_DIR="$config_dir" CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 ANTHROPIC_BASE_URL="http://127.0.0.1:8317" ANTHROPIC_AUTH_TOKEN="$gateway_key" claude -p "/kor-status" --plugin-dir "$repo_root/packages/claude-plugin" --no-session-persistence --permission-mode dontAsk --output-format text 2>&1)
claude_exit=$?
set -e

printf '%s\n' "$output"
if [ "$claude_exit" -ne 0 ]; then
  echo "claude exited with status $claude_exit" >&2
  exit "$claude_exit"
fi
case "$output" in
  *"Kor Code cockpit plugin"*|*"Kor Code cockpit"*"loaded"*) exit 0 ;;
  *) echo "plugin proof text not found" >&2; exit 1 ;;
esac
