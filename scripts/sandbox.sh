#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
sandbox_dir="$repo_root/.sandbox"
config_dir="$sandbox_dir/claude-config"
mkdir -p "$config_dir"

checksum_tree() {
  if [ ! -d "$1" ]; then printf '%s' absent; return; fi
  python3 - "$1" <<'PY'
import hashlib, os, sys
root = sys.argv[1]
digest = hashlib.sha256()
for directory, _, names in os.walk(root):
    for name in sorted(names):
        path = os.path.join(directory, name)
        try:
            with open(path, "rb") as handle:
                digest.update(path.encode())
                digest.update(handle.read())
        except FileNotFoundError:
            continue
print(digest.hexdigest(), end="")
PY
}

claude_checksum_before=$(checksum_tree "$HOME/.claude")
set +e
output=$(CLAUDE_CONFIG_DIR="$config_dir" claude -p "/kor-status" --plugin-dir "$repo_root/packages/claude-plugin" --no-session-persistence --permission-mode dontAsk --output-format text 2>&1)
claude_exit=$?
set -e
claude_checksum_after=$(checksum_tree "$HOME/.claude")

printf '%s\n' "$output"
if [ "$claude_exit" -ne 0 ]; then
  echo "claude exited with status $claude_exit" >&2
  exit "$claude_exit"
fi
if [ "$claude_checksum_before" != "$claude_checksum_after" ]; then
  echo "~/.claude checksum changed" >&2
  exit 1
fi
case "$output" in
  *"Kor Code cockpit plugin loaded"*) exit 0 ;;
  *) echo "plugin proof text not found" >&2; exit 1 ;;
esac
