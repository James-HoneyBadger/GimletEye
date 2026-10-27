#!/usr/bin/env bash
# Run the fuzz targets for a budget and record what they did.
#
# ADR 0006 Gate 2 asks for 350 target-minutes of unattended soak. The Rust soak
# cannot supply them any more (ADR 0010), so this produces the same evidence in
# the language the parsers are written in: each target runs for the requested
# minutes, and every run is appended to `fuzz/soak-ledger.jsonl`, which
# `scripts/check-fuzz-soak.sh` adds up.
#
#   ./scripts/fuzz-soak.sh --minutes 10                  # every target
#   ./scripts/fuzz-soak.sh --minutes 60 --targets jpeg,png
#
# Parallelism defaults to 3: the parsers are CPU-bound and a machine has to stay
# usable for the rest of the build.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

minutes=10
targets="jpeg png webp exif gps container"
jobs=3

while [ $# -gt 0 ]; do
    case "$1" in
        --minutes) minutes="${2:?}"; shift 2 ;;
        --targets) targets="${2//,/ }"; shift 2 ;;
        --jobs) jobs="${2:?}"; shift 2 ;;
        *) echo "fuzz-soak: unknown argument '$1'" >&2; exit 2 ;;
    esac
done

[ -f packages/engine/dist/index.js ] || { echo "fuzz-soak: build first: npm run build" >&2; exit 2; }

ledger="fuzz/soak-ledger.jsonl"
mkdir -p fuzz
fail=0

run_target() {
    local target="$1"
    local out
    out="$(nice -n 15 node scripts/fuzz.mjs --target "$target" --minutes "$minutes" --seed "${SEED:-1}" 2>&1 | tail -1)"
    case "$out" in
        \{*) printf '%s\n' "$out" >>"$ledger.tmp" ;;
        *)   printf 'fuzz-soak: %s produced no result\n' "$target" >&2; return 1 ;;
    esac
    if ! printf '%s' "$out" | grep -q '"crashes":0'; then
        printf 'fuzz-soak: %s found a crash\n  %s\n' "$target" "$out" >&2
        return 1
    fi
}

export -f run_target
export minutes ledger

: >"$ledger.tmp"
printf '%s\n' "$targets" | tr ' ' '\n' | xargs -P "$jobs" -I{} bash -c 'run_target {}' || fail=1

if [ -s "$ledger.tmp" ]; then
    cat "$ledger.tmp" >>"$ledger"
fi
rm -f "$ledger.tmp"

total="$(python3 - "$ledger" <<'PY'
import json, sys
total = 0.0
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    try:
        entry = json.loads(line)
    except ValueError:
        continue
    if entry.get('crashes', 1) == 0:
        total += float(entry.get('minutes', 0))
print(round(total, 1))
PY
)"
echo "fuzz-soak: $total target-minutes recorded in $ledger"

[ "$fail" -eq 0 ] || exit 1
