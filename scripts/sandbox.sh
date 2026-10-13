#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
real_home=${HOME:-}
sandbox_dir="$repo_root/.sandbox"
config_dir="$sandbox_dir/claude-config"
home_dir="$sandbox_dir/home"
mkdir -p "$config_dir" "$home_dir"

gateway_key="${KOR_GATEWAY_KEY:-}"
if [ -z "$gateway_key" ] && [ -r /mnt/c/Users/leeba/Tools/CLIProxyAPI/client-api-key.txt ]; then
  gateway_key=$(cat /mnt/c/Users/leeba/Tools/CLIProxyAPI/client-api-key.txt)
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

claude_checksum_before=$(checksum_surfaces "$real_home")
set +e
output=$(HOME="$home_dir" CLAUDE_CONFIG_DIR="$config_dir" ANTHROPIC_BASE_URL="http://127.0.0.1:8317" ANTHROPIC_AUTH_TOKEN="$gateway_key" claude -p "/kor-status" --plugin-dir "$repo_root/packages/claude-plugin" --no-session-persistence --permission-mode dontAsk --output-format text 2>&1)
claude_exit=$?
set -e
claude_checksum_after=$(checksum_surfaces "$real_home")

printf '%s\n' "$output"
if [ "$claude_exit" -ne 0 ]; then
  echo "claude exited with status $claude_exit" >&2
  exit "$claude_exit"
fi
if [ "$claude_checksum_before" != "$claude_checksum_after" ]; then
  echo "Claude configuration checksum changed" >&2
  exit 1
fi
case "$output" in
  *"Kor Code cockpit plugin"*|*"Kor Code cockpit"*"loaded"*) exit 0 ;;
  *) echo "plugin proof text not found" >&2; exit 1 ;;
esac
