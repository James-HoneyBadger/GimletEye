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
for command in gimlet-works gimlet; do
    [ -L "$stage/usr/bin/$command" ] || fail "usr/bin/$command is not a symlink"
    [ -x "$stage/usr/bin/$command" ] || fail "usr/bin/$command has no executable target"
    ok "usr/bin/$command -> $(readlink "$stage/usr/bin/$command")"
done

for path in \
    usr/lib/gimlet-works/cli/bin/gimlet-works \
    usr/lib/gimlet-works/cli/bin/gimlet \
    usr/lib/gimlet-works/cli/dist/main.js \
    usr/lib/gimlet-works/core/dist/index.js \
    usr/lib/gimlet-works/core/package.json \
    usr/lib/gimlet-works/engine/dist/index.js \
    usr/lib/gimlet-works/engine/package.json \
    usr/lib/gimlet-works/node_modules/smol-toml/package.json \
    usr/lib/gimlet-works/node_modules/@noble/hashes/package.json \
    usr/lib/gimlet-works/node_modules/@gimlet-works/core \
    usr/lib/gimlet-works/node_modules/@gimlet-works/engine \
    usr/share/doc/gimlet-works/README.md \
    usr/share/doc/gimlet-works/COMPATIBILITY.md; do
    [ -e "$stage/$path" ] || fail "missing $path"
done
ok "the layout is complete"

# --- and it runs -------------------------------------------------------------
export GIMLET_WORKS_HOME="$work/home"
unset GIMLET_HOME GIMLET_WORKS_SIDECAR GIMLET_SIDECAR || true
cli="$stage/usr/bin/gimlet-works"
legacy="$stage/usr/bin/gimlet"

"$cli" --version | grep -q '^gimlet-works ' || fail "the new command did not print a version"
"$legacy" --version | grep -q '^gimlet ' || fail "the legacy command did not print a version"
if "$legacy" --not-a-real-flag >"$work/legacy.out" 2>"$work/legacy.err"; then
    fail "the legacy command accepted an invalid flag"
fi
grep -q '^gimlet: ' "$work/legacy.err" || fail "the legacy command changed its error prefix"
ok "both commands and the legacy error format work"

"$cli" tools list --json | grep -q '"sysadmin.system-info"' || fail "the catalogue is incomplete"
ok "the catalogue loads"

"$cli" system-info >/dev/null || fail "a TypeScript tool failed to run"
ok "a TypeScript tool runs"

# This is the one that catches a module that only resolves in the checkout:
# `crypto.sha256` needs the engine package and its Argon2id dependency, loaded by
# name from the installed tree rather than by relative path.
"$legacy" crypto.sha256 text=hello --format json | grep -q '2cf24dba5fb0a30e' ||
    fail "the crypto tool did not run from the installed tree"
ok "a crypto tool runs"

unset GIMLET_WORKS_HOME
export XDG_CONFIG_HOME="$work/config"
mkdir -p "$XDG_CONFIG_HOME/gimlet"
[ "$("$cli" config path)" = "$XDG_CONFIG_HOME/gimlet/config.toml" ] ||
    fail "the new command did not use an existing legacy state root"
ok "the legacy state root is retained"

printf '\npackage layout: everything passed\n'
