#!/usr/bin/env bash
# Stage a package and run it, the way an installed copy would run.
#
# Packaging goes wrong in ways a version check never notices: a symlink pointing
# at the wrong depth, a module that resolves in the checkout and not under
# /usr/lib, an engine the CLI can no longer find once `node` is the process
# name. So this stages the real tree with the real script and then runs the three
# paths that matter — the version, a TypeScript tool, and an engine tool.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

stage="$work/root"
./scripts/stage-package.sh "$stage" >/dev/null

fail() { printf '\033[31m  FAIL  %s\033[0m\n' "$*" >&2; exit 1; }
ok() { printf '  ok    %s\n' "$*"; }

# --- the layout the recipes promise -----------------------------------------
[ -L "$stage/usr/bin/gimlet" ] || fail "usr/bin/gimlet is not a symlink"
target="$(readlink "$stage/usr/bin/gimlet")"
[ -x "$stage/usr/lib/gimlet/cli/bin/gimlet" ] || fail "the symlink target does not exist: $target"
ok "usr/bin/gimlet -> $target"

for path in \
    usr/lib/gimlet/cli/bin/gimlet \
    usr/lib/gimlet/cli/dist/main.js \
    usr/lib/gimlet/core/dist/index.js \
    usr/lib/gimlet/core/package.json \
    usr/lib/gimlet/engine/dist/index.js \
    usr/lib/gimlet/engine/package.json \
    usr/lib/gimlet/node_modules/smol-toml/package.json \
    usr/lib/gimlet/node_modules/@noble/hashes/package.json \
    usr/lib/gimlet/node_modules/@gimlet-eye/core \
    usr/lib/gimlet/node_modules/@gimlet-eye/engine \
    usr/share/doc/gimlet/README.md \
    usr/share/doc/gimlet/COMPATIBILITY.md; do
    [ -e "$stage/$path" ] || fail "missing $path"
done
ok "the layout is complete"

# --- and it runs -------------------------------------------------------------
export GIMLET_HOME="$work/home"
unset GIMLET_SIDECAR || true
gimlet="$stage/usr/bin/gimlet"

"$gimlet" --version | grep -q '^gimlet ' || fail "--version did not print a version"
ok "--version"

"$gimlet" tools list --json | grep -q '"sysadmin.system-info"' || fail "the catalogue is incomplete"
ok "the catalogue loads"

"$gimlet" system-info >/dev/null || fail "a TypeScript tool failed to run"
ok "a TypeScript tool runs"

# This is the one that catches a module that only resolves in the checkout:
# `crypto.sha256` needs the engine package and its Argon2id dependency, loaded by
# name from the installed tree rather than by relative path.
"$gimlet" crypto.sha256 text=hello --format json | grep -q '2cf24dba5fb0a30e' ||
    fail "the crypto tool did not run from the installed tree"
ok "a crypto tool runs"

printf '\npackage layout: everything passed\n'
