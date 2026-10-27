#!/usr/bin/env bash
# Fail when a command, flag, or route exists but is not documented as public.
#
# ADR 0006 Gate 3 asks for the CLI and the HTTP routes to be *listed* as public
# API. A list written once and maintained by hand drifts the moment someone adds
# a flag, so the list is compared with reality here: the binary reports its own
# commands and flags through `--help`, the router reports its own routes, and
# anything missing from docs/COMPATIBILITY.md fails.
#
# The reverse direction (documented but gone) is not checked: a surface may be
# documented before it ships, and a removal is allowed to keep its alias.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

doc="docs/COMPATIBILITY.md"
if [ ! -f "$doc" ]; then
    echo "missing $doc" >&2
    exit 1
fi

binary="${GIMLET_BIN:-}"
if [ -z "$binary" ]; then
    for candidate in target/release/gimlet target/debug/gimlet; do
        if [ -x "$candidate" ]; then
            binary="$candidate"
            break
        fi
    done
fi
if [ -z "$binary" ]; then
    cargo build --quiet -p gimlet-eye-cli --bin gimlet
    binary="target/debug/gimlet"
fi

missing=()

# `--help` prints the subcommands under "Commands:" and the flags under
# "Options:", one or two per line; long flags are all this needs.
commands_of() {
    "$binary" "$@" --help 2>&1 |
        sed -n '/^Commands:/,/^$/p' |
        awk 'NF && $1 != "Commands:" { print $1 }'
}

flags_of() {
    "$binary" "$@" --help 2>&1 | grep -oE '\--[a-z][a-z0-9-]*' || true
}

global_flags="$(flags_of)"

# One level of nesting is all the CLI has (`tools list`); a deeper level would be
# a design change worth noticing here. A parent that has subcommands is not
# itself runnable, so only the leaves are documented as commands.
leaves=()
for command in $(commands_of); do
    subs="$(commands_of "$command")"
    if [ -z "$subs" ]; then
        leaves+=("$command")
    else
        for sub in $subs; do
            leaves+=("$command $sub")
        done
    fi
done

for command in "${leaves[@]}"; do
    if ! grep -qE "\`gimlet $command( |\`)" "$doc"; then
        missing+=("command: gimlet $command")
    fi
done

# Flags a subcommand accepts beyond the global set.
for command in "${leaves[@]}"; do
    for flag in $(flags_of $command); do
        grep -qxF -- "$flag" <<<"$global_flags" && continue
        if ! grep -qF -- "$flag" "$doc"; then
            missing+=("flag: $flag (gimlet $command)")
        fi
    done
done

for flag in $global_flags; do
    if ! grep -qF -- "$flag" "$doc"; then
        missing+=("global flag: $flag")
    fi
done

# Routes are declared in one place, so the router is the source of truth.
while read -r method path; do
    if ! grep -qF "$method $path" "$doc"; then
        missing+=("route: $method $path")
    fi
done < <(grep -oE '\.route\("[^"]+", (get|post|put|patch|delete)\(' crates/server/src/routes.rs |
    sed -E 's/\.route\("([^"]+)", ([a-z]+)\(/\U\2\E \1/')

if [ "${#missing[@]}" -gt 0 ]; then
    echo "undocumented public surface ($doc):" >&2
    printf '  %s\n' "${missing[@]}" >&2
    exit 1
fi

count="${#leaves[@]}"
echo "ok   $count command(s), $(sort -u <<<"$global_flags" | wc -l | tr -d ' ') global flag(s), $(grep -cE '\.route\(' crates/server/src/routes.rs) route(s) documented"
