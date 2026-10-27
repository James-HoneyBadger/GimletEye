#!/usr/bin/env bash
# Has the soak accumulated the evidence Gate 2 asks for?
#
# ADR 0006: "seven consecutive nights or 350 target-minutes of unattended soak,
# with the same targets, the same assertions, and the same seeded corpus". The
# ledger is committed so the claim is a file in the repository rather than a CI
# job's memory, and any recorded crash makes the evidence invalid until it is
# explained.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

budget="${SOAK_MINUTES:-350}"
ledger="fuzz/soak-ledger.jsonl"

if [ ! -s "$ledger" ]; then
    echo "no soak recorded: run ./scripts/fuzz-soak.sh --minutes N" >&2
    exit 1
fi

python3 - "$ledger" "$budget" <<'PY'
import json, sys
from collections import defaultdict

ledger, budget = sys.argv[1], float(sys.argv[2])
minutes = defaultdict(float)
iterations = 0
crashes = []

for number, line in enumerate(open(ledger), 1):
    line = line.strip()
    if not line:
        continue
    try:
        entry = json.loads(line)
    except ValueError:
        crashes.append(f'line {number} is not JSON')
        continue
    if entry.get('crashes', 0) != 0:
        crashes.append(f"{entry.get('target')} run recorded {entry.get('crashes')} crash(es)")
        continue
    minutes[entry.get('target', '?')] += float(entry.get('minutes', 0))
    iterations += int(entry.get('iterations', 0))

total = sum(minutes.values())
detail = ', '.join(f'{name} {value:g}' for name, value in sorted(minutes.items()))

if crashes:
    print(f"soak records {len(crashes)} problem(s): " + '; '.join(crashes), file=sys.stderr)
    sys.exit(1)
if total < budget:
    print(f'{total:g} of {budget:g} target-minutes ({detail}); {iterations} inputs', file=sys.stderr)
    sys.exit(1)
print(f'{total:g} target-minutes over {len(minutes)} targets ({detail}); {iterations} inputs, no crashes')
PY
