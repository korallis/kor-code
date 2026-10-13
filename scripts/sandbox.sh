#!/usr/bin/env bash
# Runs Claude Code with the cockpit plugin in a disposable configuration.
#   scripts/sandbox.sh                 headless /kor-status proof
#   scripts/sandbox.sh "/kor replay"   any headless prompt, same guards
#   scripts/sandbox.sh --interactive   the TUI, for driving the cockpit by hand
#   scripts/sandbox.sh --live-model …  opt in to model calls through CLIProxyAPI
# By default the run is offline: the child's model endpoint is
# scripts/offline-endpoint.py on an ephemeral loopback port, so CLIProxyAPI
# (127.0.0.1:8317) is never contacted and its key is never read.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
real_home=${HOME:-}
sandbox_dir="$repo_root/.sandbox"
config_dir="$sandbox_dir/claude-config"
home_dir="$sandbox_dir/home"
mkdir -p "$config_dir" "$home_dir"

# The real user homes the child must never reach, not even by a stat. The
# harness never opens them either: these paths are only compared as strings.
# scripts/isolation-proof.sh traces the child to prove it.
forbidden=("$real_home/.claude" "$real_home/.claude.json" "$real_home/.codex" "$real_home/.agents")
is_forbidden() {
  local path=$1 root
  for root in "${forbidden[@]}"; do
    case "$path" in "$root" | "$root"/*) return 0 ;; esac
  done
  return 1
}

# Claude Code walks up from its working directory reading CLAUDE.md, AGENTS.md,
# .claude/ and .mcp.json in every ancestor, and the real ~/.claude is the
# ancestor .claude of anything under the home directory. So the child runs in
# a fresh root outside every home, with its own git root and scratch directory.
run_root=$(mktemp -d /tmp/kor-sandbox.XXXXXX)
stub_pid=""
trap '[ -z "$stub_pid" ] || kill "$stub_pid" 2>/dev/null; rm -rf "$run_root"' EXIT
work_dir="$run_root/cwd"
tmp_dir="$run_root/tmp"
mkdir -p "$work_dir" "$tmp_dir"
git -C "$work_dir" init -q
case "$work_dir/" in "$real_home"/*) echo "sandbox: working directory $work_dir is inside the real home" >&2; exit 1 ;; esac
ancestor=$run_root
while [ "$ancestor" != / ]; do
  ancestor=$(dirname "$ancestor")
  for name in .claude .mcp.json CLAUDE.md CLAUDE.local.md AGENTS.md; do
    if [ -e "${ancestor%/}/$name" ]; then echo "sandbox: ${ancestor%/}/$name would reach the session" >&2; exit 1; fi
  done
done

# Claude is called by absolute path with a PATH of system directories only, so
# no shim directory from the invoking session (such as Codex's) is ever probed.
claude_bin=$(command -v claude) || { echo "sandbox: claude not found" >&2; exit 1; }
child_path=""
for directory in /usr/local/sbin /usr/local/bin /usr/sbin /usr/bin /sbin /bin; do
  [ -d "$directory" ] && child_path="${child_path:+$child_path:}$directory"
done
child_shell=$(PATH="$child_path" command -v bash)
for path in "$claude_bin" "$(readlink -f "$claude_bin")" "$config_dir" "$home_dir"; do
  if is_forbidden "$path"; then echo "sandbox: $path is inside a real user home" >&2; exit 1; fi
done

interactive=0
live_model=0
while [ $# -gt 0 ]; do
  case "$1" in
    --interactive) interactive=1; shift ;;
    --live-model) live_model=1; shift ;;
    *) break ;;
  esac
done
prompt=${1:-/kor-status}

if [ "$live_model" -eq 1 ]; then
  # A client of the existing CLIProxyAPI, never its operator: nothing here
  # starts, stops or reconfigures it.
  gateway_url="${KOR_GATEWAY_URL:-http://127.0.0.1:8317}"
  gateway_key="${KOR_GATEWAY_KEY:-}"
  gateway_key_file="${KOR_GATEWAY_KEY_FILE:-}"
  if [ -z "$gateway_key" ] && [ -n "$gateway_key_file" ]; then
    if [ ! -r "$gateway_key_file" ]; then
      echo "KOR_GATEWAY_KEY_FILE is not readable" >&2
      exit 1
    fi
    gateway_key=$(cat "$gateway_key_file")
  fi
  [ -n "$gateway_key" ] || { echo "sandbox: --live-model needs KOR_GATEWAY_KEY or KOR_GATEWAY_KEY_FILE" >&2; exit 1; }
  echo "sandbox: live model calls go to $gateway_url" >&2
else
  python3 -I "$repo_root/scripts/offline-endpoint.py" >"$run_root/endpoint.port" &
  stub_pid=$!
  for _ in $(seq 50); do [ -s "$run_root/endpoint.port" ] && break; sleep 0.1; done
  stub_port=$(head -n1 "$run_root/endpoint.port")
  case "$stub_port" in '' | *[!0-9]* | 8317) echo "sandbox: offline endpoint did not start" >&2; exit 1 ;; esac
  gateway_url="http://127.0.0.1:$stub_port"
  gateway_key="kor-sandbox-offline"
fi

# Skip first-run onboarding and the trust dialog inside the throwaway config only;
# trust covers this run's working directory alone.
python3 - "$config_dir/.claude.json" "$(cd "$work_dir" && pwd -P)" <<'PY'
import json, sys
path, work = sys.argv[1], sys.argv[2]
try:
    with open(path) as handle:
        state = json.load(handle)
except FileNotFoundError:
    state = {}
state.update(hasCompletedOnboarding=True, theme=state.get("theme", "dark"))
state["projects"] = {work: {"hasTrustDialogAccepted": True, "hasCompletedProjectOnboarding": True}}
with open(path, "w") as handle:
    json.dump(state, handle, indent=2)
PY

# The child starts from an empty environment: nothing from the invoking session
# (XDG paths, IDE ports, CLAUDE_* or CODEX_* variables) reaches it. The list is
# exported by the builtin, so the gateway key never appears on a command line.
# Memory files and the autoupdater are off, and Claude's scratch files stay in
# this run's root. Non-essential traffic stays on: it carries the feature flags
# that give the cockpit its full-width pane. CLAUDE_CODE_PLUGIN_DIR_WATCH lays
# the engine's API types beside the plugin (.claude-plugin/types, gitignored) so
# `pnpm typecheck` can check the mod.
child_env=(
  HOME="$home_dir" PATH="$child_path" SHELL="$child_shell" TMPDIR="$tmp_dir"
  CLAUDE_CONFIG_DIR="$config_dir" CLAUDE_CODE_TMPDIR="$tmp_dir"
  CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 DISABLE_AUTOUPDATER=1
  CLAUDE_CODE_PLUGIN_DIR_WATCH=1
  ANTHROPIC_BASE_URL="$gateway_url" ANTHROPIC_AUTH_TOKEN="$gateway_key"
)
for name in TERM COLORTERM LANG LC_ALL LC_CTYPE TZ USER LOGNAME; do
  [ -z "${!name:-}" ] || child_env+=("$name=${!name}")
done
run_claude() {
  (
    cd "$work_dir"
    for name in $(compgen -e); do unset "$name" 2>/dev/null || true; done
    export "${child_env[@]}"
    exec "$claude_bin" --plugin-dir "$repo_root/packages/claude-plugin" "$@"
  )
}

set +e
if [ "$interactive" -eq 1 ]; then
  run_claude
  claude_exit=$?
  output=""
else
  output=$(run_claude -p "$prompt" --no-session-persistence --permission-mode dontAsk --output-format text 2>&1 </dev/null)
  claude_exit=$?
fi
set -e

[ -z "$output" ] || printf '%s\n' "$output"
if [ "$claude_exit" -ne 0 ]; then
  echo "claude exited with status $claude_exit" >&2
  exit "$claude_exit"
fi
# /kor-status is answered by the plugin's own hook, never by the model, so the proof text is exact.
if [ "$interactive" -eq 0 ] && [ "$prompt" = "/kor-status" ]; then
  case "$output" in
    *"Kor Code cockpit plugin loaded (session-local; no configuration changes)."*) exit 0 ;;
    *) echo "plugin proof text not found" >&2; exit 1 ;;
  esac
fi
