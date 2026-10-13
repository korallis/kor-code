#!/usr/bin/env bash
# Runs Claude Code with the cockpit plugin in a disposable configuration.
#   scripts/sandbox.sh                 headless /kor-status proof
#   scripts/sandbox.sh "/kor replay"   any headless prompt, same guards
#   scripts/sandbox.sh --interactive   the TUI, for driving the cockpit by hand
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
real_home=${HOME:-}
sandbox_dir="$repo_root/.sandbox"
config_dir="$sandbox_dir/claude-config"
home_dir="$sandbox_dir/home"
mkdir -p "$config_dir" "$home_dir"

# The real user homes the child must never reach, not even by a stat.
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
trap 'rm -rf "$run_root"' EXIT
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
if [ "${1:-}" = "--interactive" ]; then interactive=1; shift; fi
prompt=${1:-/kor-status}

gateway_key="${KOR_GATEWAY_KEY:-}"
gateway_key_file="${KOR_GATEWAY_KEY_FILE:-}"
if [ -z "$gateway_key" ] && [ -n "$gateway_key_file" ]; then
  if [ ! -r "$gateway_key_file" ]; then
    echo "KOR_GATEWAY_KEY_FILE is not readable" >&2
    exit 1
  fi
  gateway_key=$(cat "$gateway_key_file")
fi

checksum_surfaces() {
  python3 - "$1" <<'PY'
import hashlib, json, os, sys
root = sys.argv[1]
digest = hashlib.sha256()
claude = os.path.join(root, ".claude")
files = ["settings.json", "settings.local.json", "CLAUDE.md", "keybindings.json", ".credentials.json"]
for directory in ("plugins", "skills", "hooks", "agents", "commands"):
    base = os.path.join(claude, directory)
    for current, dirs, names in os.walk(base):
        if directory == "plugins":
            dirs[:] = [name for name in dirs if name != ".in_use"]
        files.extend(os.path.relpath(os.path.join(current, name), claude) for name in names)
for relative in files:
    path = os.path.join(claude, relative)
    try:
        with open(path, "rb") as handle:
            content = handle.read()
        if relative == "plugins/known_marketplaces.json":
            def stable(value):
                if isinstance(value, dict):
                    return {key: stable(item) for key, item in value.items() if key != "lastUpdated"}
                if isinstance(value, list):
                    return [stable(item) for item in value]
                return value
            content = json.dumps(stable(json.loads(content)), sort_keys=True, separators=(",", ":")).encode()
        digest.update(relative.encode())
        digest.update(content)
    except FileNotFoundError:
        continue
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise SystemExit(f"cannot parse checksum surface: {relative}")
claude_json = os.path.join(root, ".claude.json")
try:
    with open(claude_json, "rb") as handle:
        value = json.load(handle)
    digest.update(b".claude.json:mcpServers")
    digest.update(json.dumps(value.get("mcpServers"), sort_keys=True, separators=(",", ":")).encode())
except FileNotFoundError:
    digest.update(b".claude.json:mcpServers:absent")
except (json.JSONDecodeError, AttributeError):
    raise SystemExit("cannot parse checksum surface: .claude.json")
print(digest.hexdigest(), end="")
PY
}

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
  ANTHROPIC_BASE_URL="http://127.0.0.1:8317" ANTHROPIC_AUTH_TOKEN="$gateway_key"
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

claude_checksum_before=$(checksum_surfaces "$real_home")
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
claude_checksum_after=$(checksum_surfaces "$real_home")

[ -z "$output" ] || printf '%s\n' "$output"
if [ "$claude_exit" -ne 0 ]; then
  echo "claude exited with status $claude_exit" >&2
  exit "$claude_exit"
fi
if [ "$claude_checksum_before" != "$claude_checksum_after" ]; then
  echo "Claude configuration checksum changed" >&2
  exit 1
fi
echo "sandbox: Claude configuration checksum unchanged" >&2
# /kor-status is answered by the plugin's own hook, never by the model, so the proof text is exact.
if [ "$interactive" -eq 0 ] && [ "$prompt" = "/kor-status" ]; then
  case "$output" in
    *"Kor Code cockpit plugin loaded (session-local; no configuration changes)."*) exit 0 ;;
    *) echo "plugin proof text not found" >&2; exit 1 ;;
  esac
fi
