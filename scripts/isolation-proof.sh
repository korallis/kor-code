#!/usr/bin/env bash
# Traces every file, exec and socket syscall of the sandboxed Claude Code and
# fails if any of them names the real Claude, Codex or agents homes or the
# CLIProxyAPI tree. The trace covers only the child, so live sessions elsewhere
# on the host cannot make it pass or fail.
#   scripts/isolation-proof.sh                 traces the /kor-status proof
#   scripts/isolation-proof.sh "/kor replay"   traces any headless prompt
#   scripts/isolation-proof.sh --interactive   traces the TUI until it exits
# Needs strace on PATH, or STRACE=/path/to/strace.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
real_home=${HOME:?HOME must be set}
strace_bin=${STRACE:-$(command -v strace || true)}
[ -x "$strace_bin" ] || { echo "isolation proof: strace not found (set STRACE)" >&2; exit 1; }
claude_bin=$(command -v claude) || { echo "isolation proof: claude not found" >&2; exit 1; }

proof_dir=$(mktemp -d /tmp/kor-isolation.XXXXXX)
trap 'rm -rf "$proof_dir"' EXIT
trace="$proof_dir/trace"
mkdir "$proof_dir/bin"
# sandbox.sh resolves claude from this PATH, then runs it with an empty environment.
cat >"$proof_dir/bin/claude" <<EOF
#!/bin/sh
exec "$strace_bin" -f -qq -s 4096 -e trace=%file,%process,connect,bind -o "$trace" "$claude_bin" "\$@"
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
echo "isolation proof: $syscalls syscalls traced across $pids processes"
if [ -n "$violations" ]; then
  printf '%s\n' "$violations" | head -20 >&2
  echo "isolation proof: FAILED — the child touched a real user home" >&2
  exit 1
fi
echo "isolation proof: no access to ~/.claude, ~/.claude.json, ~/.codex, ~/.agents or CLIProxyAPI"
exit "$sandbox_exit"
