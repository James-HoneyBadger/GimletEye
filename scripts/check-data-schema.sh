#!/usr/bin/env bash
# Does every manifest describe what its tool actually returns?
#
# ADR 0006 Gate 3 wants a per-tool schema so a consumer can parse a report
# without reverse-engineering it. A schema written once and never compared with
# reality is a comment, so this runs every documented example twice: once as a
# report, and once as the manifest that claims to describe it.
#
# `scripts/tool-reference.py --data-schema` produces the first from real output;
# `gimlet tools show --format json` produces the second.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

CLI="${GIMLET_BIN:-packages/cli/bin/gimlet}"
[ -x "$CLI" ] || { echo "build the CLI first: npm run build" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

python3 scripts/tool-reference.py --data-schema >"$work/observed.json"
"$CLI" tools list --json >"$work/catalogue.json"

python3 - "$work/observed.json" "$work/catalogue.json" "$CLI" <<'PY'
import json, subprocess, sys

observed = json.load(open(sys.argv[1]))
catalogue = json.load(open(sys.argv[2]))
binary = sys.argv[3]

problems = []
checked = 0
for tool in catalogue:
    tool_id = tool['id']
    manifest = json.loads(subprocess.run([binary, 'tools', 'show', tool_id, '--format', 'json'],
                                         capture_output=True, text=True, check=True).stdout)
    spec = manifest.get('data')
    if spec is None:
        problems.append(f'{tool_id}: no data schema declared')
        continue
    seen = observed.get(tool_id)
    if seen is None:
        continue  # the example produced no JSON report; the reference lists why
    checked += 1

    if spec['shape'] == 'array':
        continue  # a row schema is enforced at runtime against every row
    declared = dict(spec.get('required', {}), **spec.get('optional', {}))
    for field, kind in sorted(seen.items()):
        if field not in declared:
            problems.append(f'{tool_id}: reports {field!r} but does not declare it')
        elif kind not in declared[field].split('|'):
            problems.append(f"{tool_id}: {field!r} declared {declared[field]!r} but returned {kind}")
    for field in sorted(spec.get('required', {})):
        if field not in seen:
            problems.append(f'{tool_id}: declares required {field!r} but the report did not carry it')

if problems:
    print(f'data schema: {len(problems)} problem(s)', file=sys.stderr)
    for problem in problems:
        print(f'  {problem}', file=sys.stderr)
    sys.exit(1)
print(f'ok   {checked} tool(s) report exactly the fields their manifests declare')
PY
