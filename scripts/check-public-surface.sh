#!/usr/bin/env bash
# Fail when a command or flag exists but is not documented as public.
#
# ADR 0006 Gate 3 asks for the command surface to be *listed* as public API. A
# list written once and maintained by hand drifts the moment someone adds a flag,
# so the list is compared with reality here: the CLI declares its own surface in
# `packages/cli/src/surface.ts` (which `--help` renders), and anything missing
# from docs/COMPATIBILITY.md fails.
#
# The reverse direction (documented but gone) is not checked: a surface may be
# documented before it ships.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

doc="docs/COMPATIBILITY.md"
if [ ! -f "$doc" ]; then
    echo "missing $doc" >&2
    exit 1
fi

if [ ! -f packages/cli/dist/surface.js ]; then
    npm run build --silent
fi

declared="$(node -e '
import("./packages/cli/dist/surface.js").then((m) => {
  const entries = [...m.COMMANDS, ...m.GLOBAL_FLAGS, ...m.BATCH_FLAGS];
  for (const entry of entries) {
    for (const name of entry.command.split(", ")) console.log(name);
  }
});
')"

missing=()
while read -r name; do
    [ -z "$name" ] && continue
    # A command is documented as `gimlet <command>`; a flag as `--flag`.
    case "$name" in
        --* | -*) needle="$name" ;;
        *) needle="gimlet $name" ;;
    esac
    grep -qF -- "$needle" "$doc" || missing+=("$name")
done <<<"$declared"

if [ "${#missing[@]}" -gt 0 ]; then
    echo "undocumented public surface ($doc):" >&2
    printf '  %s\n' "${missing[@]}" >&2
    exit 1
fi

count="$(wc -l <<<"$declared" | tr -d ' ')"
echo "ok   $count command(s) and flag(s) documented"
