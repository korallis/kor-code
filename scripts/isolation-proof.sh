#!/usr/bin/env bash
# Traces every file, exec and network syscall of the sandboxed Claude Code and
# fails if any of them names the real Claude, Codex or agents homes or the
# CLIProxyAPI tree, or touches CLIProxyAPI's port 8317 (connect, bind or a
# request naming it). The trace covers only the child, so live sessions
# elsewhere on the host cannot make it pass or fail. It proves offline runs
# only: --live-model and the controller's --run contact CLIProxyAPI by design.
#   scripts/isolation-proof.sh                 traces the /kor-status proof
#   scripts/isolation-proof.sh "/kor demo replay"   traces any headless prompt
#   scripts/isolation-proof.sh --interactive   traces the TUI until it exits
# Needs strace on PATH, or STRACE=/path/to/strace. Set KOR_CLIPROXYAPI_DIR to the
# CLIProxyAPI install directory to also require its configuration unchanged.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
for argument in "$@"; do
  case "$argument" in
    --live-model | --run) echo "isolation proof: $argument contacts CLIProxyAPI by design; the proof covers offline runs" >&2; exit 1 ;;
  esac
done
real_home=${HOME:?HOME must be set}
strace_bin=${STRACE:-$(command -v strace || true)}
[ -x "$strace_bin" ] || { echo "isolation proof: strace not found (set STRACE)" >&2; exit 1; }
claude_bin=$(command -v claude) || { echo "isolation proof: claude not found" >&2; exit 1; }

# Digest of CLIProxyAPI's configuration: its YAML, TOML, JSON and key files,
# except the oauth/ credentials the proxy refreshes on its own. Read-only, and
# only the digest is printed.
cliproxyapi_digest() {
  python3 -I - "$1" <<'PY'
import hashlib, os, sys
root = sys.argv[1]
digest, count = hashlib.sha256(), 0
for current, dirs, names in os.walk(root):
    dirs[:] = sorted(name for name in dirs if name not in ("oauth", "node_modules"))
    for name in sorted(names):
        if name.endswith((".yaml", ".yml", ".toml", ".json")) or (name.endswith(".txt") and "key" in name):
            path = os.path.join(current, name)
            with open(path, "rb") as handle:
                digest.update(os.path.relpath(path, root).encode() + b"\0" + handle.read())
            count += 1
print(f"files={count} sha256={digest.hexdigest()}")
PY
}
cliproxyapi_dir=${KOR_CLIPROXYAPI_DIR:-}
if [ -n "$cliproxyapi_dir" ]; then
  [ -d "$cliproxyapi_dir" ] || { echo "isolation proof: KOR_CLIPROXYAPI_DIR is not a directory" >&2; exit 1; }
  cliproxyapi_before=$(cliproxyapi_digest "$cliproxyapi_dir")
fi

proof_dir=$(mktemp -d /tmp/kor-isolation.XXXXXX)
trap 'rm -rf "$proof_dir"' EXIT
trace="$proof_dir/trace"
mkdir "$proof_dir/bin"
# sandbox.sh resolves claude from this PATH, then runs it with an empty environment.
cat >"$proof_dir/bin/claude" <<EOF
#!/bin/sh
exec "$strace_bin" -f -qq -s 4096 -e trace=%file,%process,%network -o "$trace" "$claude_bin" "\$@"
EOF
chmod +x "$proof_dir/bin/claude"

# The trace is judged even when the sandbox fails, so a failed run still shows
# whether the child touched a real home.
sandbox_exit=0
PATH="$proof_dir/bin:$PATH" bash "$repo_root/scripts/sandbox.sh" "$@" || sandbox_exit=$?

[ -s "$trace" ] || { echo "isolation proof: no trace recorded (sandbox exit $sandbox_exit)" >&2; exit 1; }
syscalls=$(wc -l <"$trace")
pids=$(cut -d' ' -f1 "$trace" | sort -u | wc -l)
violations=$(grep -F -e "\"$real_home/.claude" -e "\"$real_home/.codex" -e "\"$real_home/.agents" "$trace" || true)
violations+=$(grep -i 'cliproxyapi' "$trace" || true)
port_contacts=$(grep -E 'htons\(8317\)|:8317\b' "$trace" || true)
# Loopback destinations the child connected to, for the record: only the
# offline endpoint should appear.
loopback=$(grep -oE 'connect\([0-9]+, \{sa_family=AF_INET, sin_port=htons\([0-9]+\), sin_addr=inet_addr\("127\.[0-9.]+"\)' "$trace" \
  | sed -E 's/.*htons\(([0-9]+)\).*inet_addr\("([^"]+)"\)/\2:\1/' | sort -u | paste -sd' ' || true)
echo "isolation proof: $syscalls syscalls traced across $pids processes"
echo "isolation proof: loopback connects: ${loopback:-none}"
failed=0
if [ -n "$violations" ]; then
  printf '%s\n' "$violations" | head -20 >&2
  echo "isolation proof: FAILED — the child touched a real user home" >&2
  failed=1
fi
if [ -n "$port_contacts" ]; then
  printf '%s\n' "$port_contacts" | head -20 >&2
  echo "isolation proof: FAILED — the child contacted port 8317 (CLIProxyAPI)" >&2
  failed=1
fi
if [ -n "$cliproxyapi_dir" ]; then
  cliproxyapi_after=$(cliproxyapi_digest "$cliproxyapi_dir")
  echo "isolation proof: CLIProxyAPI configuration before $cliproxyapi_before"
  echo "isolation proof: CLIProxyAPI configuration after  $cliproxyapi_after"
  if [ "$cliproxyapi_before" != "$cliproxyapi_after" ]; then
    echo "isolation proof: FAILED — CLIProxyAPI configuration changed during the run" >&2
    failed=1
  fi
else
  echo "isolation proof: CLIProxyAPI configuration not checked (set KOR_CLIPROXYAPI_DIR)"
fi
[ "$failed" -eq 0 ] || exit 1
echo "isolation proof: no access to ~/.claude, ~/.claude.json, ~/.codex, ~/.agents or CLIProxyAPI, and no contact with port 8317"
exit "$sandbox_exit"
