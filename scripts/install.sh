#!/bin/sh
# May be run from a file, or streamed to sh/bash. Never evaluates credential files.
set -eu
fail() { printf 'FAIL install: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

main() {
pilot=
linear_team=
systemd=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --pilot) [ "$#" -ge 2 ] && [ -n "$2" ] || fail '--pilot needs a Git checkout path'; pilot=$2; shift 2 ;;
    --linear-team) [ "$#" -ge 2 ] && [ -n "$2" ] || fail '--linear-team needs a Linear team key'; linear_team=$2; shift 2 ;;
    --no-systemd) systemd=no; shift ;;
    --help|-h) say 'Usage: install.sh [--pilot CHECKOUT] [--linear-team KEY] [--no-systemd]'; say 'Environment: KOR_HOME, KOR_GATEWAY_URL, KOR_REPOSITORY, KOR_REF'; exit 0 ;;
    *) fail "Unknown option: $1 (use --help)" ;;
  esac
done
[ "$(uname -s)" = Linux ] || fail 'Linux is required (Windows users: run this inside WSL2 Ubuntu).'
for tool in node git corepack claude; do
  command -v "$tool" >/dev/null 2>&1 || {
    case "$tool" in
      node) fail 'Install Node.js 24 or newer: https://nodejs.org/en/download' ;;
      git) fail 'Install Git: sudo apt install git' ;;
      corepack) fail 'Install Corepack: npm install -g corepack (then rerun this script).' ;;
      claude) fail 'Install Claude Code 2.1.299 or newer: https://code.claude.com/docs/en/setup' ;;
    esac
  }
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || fail 'Node.js 24 or newer is required; upgrade Node and rerun.'
claude_version=$(claude --version 2>/dev/null) || fail 'Claude Code could not start; repair your Claude installation.'
node -e 'const m=/^(\d+)\.(\d+)\.(\d+)(?: \(Claude Code\))?$/.exec(process.argv[1]); process.exit(m && (Number(m[1])>2 || Number(m[1])===2 && (Number(m[2])>1 || Number(m[2])===1 && Number(m[3])>=299)) ? 0 : 1)' "$claude_version" || fail 'Upgrade Claude Code to 2.1.299 or newer: claude update'
# Authentication is configured after installation; 401 proves the proxy is reachable.
node --input-type=module - <<'JS' || fail 'CLIProxyAPI is unreachable. Start it, or export KOR_GATEWAY_URL=http://HOST:PORT and rerun.'
try {
  const url = new URL(process.env.KOR_GATEWAY_URL || process.env.CPA_BASE_URL || 'http://127.0.0.1:8317');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  const response = await fetch(`${url.href.replace(/\/$/, '')}/v1/models`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  await response.body?.cancel();
  if (![200, 401, 403].includes(response.status)) throw new Error();
} catch { process.exit(1); }
JS

KOR_HOME=${KOR_HOME:-"$HOME/.local/share/kor-code"}
repository=${KOR_REPOSITORY:-https://github.com/korallis/kor-code.git}
ref=${KOR_REF:-main}
case "$KOR_HOME" in /*) ;; *) fail 'KOR_HOME must be an absolute Linux path.' ;; esac
case "$KOR_HOME" in /mnt/*) fail 'Keep KOR_HOME in the Linux filesystem, for example ~/.local/share/kor-code.' ;; esac
# Use gh's existing login for a private clone, or a token supplied in the environment.
# Credentials stay out of git URLs, process arguments and output.
kor_git() {
  if [ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]; then
    git -c credential.helper= -c 'credential.helper=!f() { printf "username=x-access-token\npassword=%s\n" "${GH_TOKEN:-$GITHUB_TOKEN}"; }; f' "$@"
  elif command -v gh >/dev/null 2>&1; then
    git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"
  else
    git "$@"
  fi
}
if [ -d "$KOR_HOME/.git" ]; then
  [ "$(git -C "$KOR_HOME" remote get-url origin)" = "$repository" ] || fail 'KOR_HOME has a different origin; choose another KOR_HOME.'
  [ -z "$(git -C "$KOR_HOME" status --porcelain --untracked-files=normal)" ] || fail 'KOR_HOME has local edits. Commit or save them before updating.'
  [ "$(git -C "$KOR_HOME" symbolic-ref --short HEAD 2>/dev/null || git -C "$KOR_HOME" describe --tags --exact-match HEAD)" = "$ref" ] || fail 'KOR_HOME is on a different branch; use its original KOR_REF.'
  say 'Updating Kor Code…'
  kor_git -C "$KOR_HOME" fetch --quiet origin "$ref" || fail 'Git fetch failed; check the repository URL, KOR_REF and network access. Private repositories also require gh auth login or GH_TOKEN.'
  git -C "$KOR_HOME" merge --ff-only --quiet FETCH_HEAD || fail 'Update is not a fast-forward. Save your local commits before retrying.'
else
  [ ! -e "$KOR_HOME" ] || fail 'KOR_HOME exists but is not a Kor clone; choose an empty path.'
  mkdir -p "$(dirname "$KOR_HOME")"
  say 'Cloning Kor Code…'
  kor_git clone --quiet --branch "$ref" -- "$repository" "$KOR_HOME" || fail 'Clone failed; check the repository URL, KOR_REF and network access. Private repositories also require gh auth login or GH_TOKEN.'
fi
cd "$KOR_HOME"
# Corepack uses the exact pnpm version declared by the checkout, without changing global shims.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
installer_cache="${XDG_CACHE_HOME:-$HOME/.cache}/kor-code"
export COREPACK_HOME="$installer_cache/corepack"
export PNPM_HOME="$installer_cache/pnpm"
XDG_CACHE_HOME="$installer_cache" corepack pnpm --version >/dev/null || fail 'Corepack could not prepare pnpm; check network access and update Corepack with npm install -g corepack.'
installed=no
if node -e 'const fs=require("node:fs"); try { process.exit(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).phase === "installed" ? 0 : 1); } catch { process.exit(1); }' "${XDG_STATE_HOME:-$HOME/.local/state}/kor-install/manifest.json"; then installed=yes; fi
if [ -z "$pilot" ] && [ "$installed" = yes ]; then
  pilot=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).pilot)' "${XDG_STATE_HOME:-$HOME/.local/state}/kor-install/manifest.json")
fi
if [ -z "$pilot" ]; then
  printf 'Project Git checkout (absolute path): ' 2>/dev/null >/dev/tty || fail 'No terminal available; pass --pilot /path/to/project.'
  IFS= read -r pilot </dev/tty || fail 'Could not read project path; pass --pilot /path/to/project.'
  [ -n "$pilot" ] || fail 'Pass --pilot /path/to/project.'
fi
if [ -n "$pilot" ]; then
  case "$pilot" in '~/'*) pilot="$HOME/${pilot#\~/}" ;; esac
  pilot=$(cd "$pilot" 2>/dev/null && pwd -P) || fail 'The --pilot directory does not exist.'
  [ "$(git -C "$pilot" rev-parse --show-toplevel 2>/dev/null)" = "$pilot" ] || fail '--pilot must be a Git checkout root.'
fi
if [ ! -f "${XDG_CONFIG_HOME:-$HOME/.config}/kor/config.yaml" ] && [ -z "$linear_team" ]; then
  printf 'Linear team key (for example APP): ' 2>/dev/null >/dev/tty || fail 'No terminal available; pass --linear-team KEY.'
  IFS= read -r linear_team </dev/tty || fail 'Could not read Linear team key; pass --linear-team KEY.'
  [ -n "$linear_team" ] || fail 'Pass --linear-team KEY.'
fi
say 'Installing dependencies and building Kor Code and Mission Control…'
XDG_CACHE_HOME="$installer_cache" corepack pnpm install --frozen-lockfile --store-dir "$installer_cache/pnpm/store" --state-dir "$installer_cache/pnpm/state"
# Workspace build scripts call `pnpm` too. Supply a user-local shim even
# when Corepack's global pnpm shims have never been enabled.
pnpm_bin="$installer_cache/bin"
mkdir -p "$pnpm_bin"
corepack enable pnpm --install-directory "$pnpm_bin" || fail 'Could not create the local pnpm shim; check permissions in your cache directory.'
PATH="$pnpm_bin:$PATH"
export PATH
XDG_CACHE_HOME="$installer_cache" corepack pnpm build
# A user manager is optional (containers and some WSL installations have none).
if [ -z "$systemd" ]; then
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then systemd=yes; else systemd=no; fi
fi
set -- install
[ -z "$pilot" ] || set -- "$@" --pilot "$pilot"
[ -z "$linear_team" ] || set -- "$@" --linear-team "$linear_team"
[ "$systemd" = yes ] || set -- "$@" --no-systemd
node packages/cli/dist/cli.js "$@"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) say 'Add this to your shell profile, and run it in this terminal:'; say '  export PATH="$HOME/.local/bin:$PATH"' ;;
esac
if [ "$installed" = no ]; then say 'Next: add the gateway api-keys line above to CLIProxyAPI and reload it.'; fi
say 'Configure checks and toolAllowlist in ~/.config/kor/config.yaml, then run kor doctor.'
say 'Launch Mission Control: kor ui (or "$HOME/.local/bin/kor" ui before updating PATH).'
say 'To update, rerun this same installer. To remove: kor uninstall --purge.'

}
main "$@"
