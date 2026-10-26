#!/usr/bin/env bash
# Report whether the fuzz soak has met its evidence bar.
#
# ADR 0006 Gate 2, as amended on 2026-10-26, accepts either:
#
#   * seven consecutive *scheduled* nights, or
#   * 350 target-minutes of green soak — seven nights at the default ten minutes
#     across five targets — which a longer dispatch can accumulate in one run.
#
# Both numbers are reported, because they buy different things: the volume is
# execution depth, the nightly cadence is also what notices a soak that stopped
# building. A dispatched run never counts toward the nights, and a cancellation
# does not count toward either.
#
# Usage: scripts/check-fuzz-nights.sh [--nights N] [--minutes M] [--repo OWNER/NAME]
set -euo pipefail

nights=7
minutes=350
repo=""

while [ $# -gt 0 ]; do
    case "$1" in
        --nights)
            nights="$2"
            shift 2
            ;;
        --minutes)
            minutes="$2"
            shift 2
            ;;
        --repo)
            repo="$2"
            shift 2
            ;;
        *)
            echo "unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

command -v gh >/dev/null || {
    echo "gh is not installed: the fuzz history cannot be read" >&2
    exit 2
}

if [ -z "$repo" ]; then
    repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

# Keep the window honest: no nulls, no cancellations, no dispatched runs.
runs="$(gh run list --repo "$repo" --workflow fuzz.yml --event schedule \
    --limit "$nights" --json conclusion,createdAt,displayTitle,headBranch \
    --jq '.[] | "\(.conclusion // "running")\t\(.createdAt)\t\(.headBranch)"')"

total="$(grep -c . <<<"$runs" || true)"
green="$(awk -F'\t' '$1 == "success"' <<<"$runs" | grep -c . || true)"
distinct_days="$(awk -F'\t' '$1 == "success" { print substr($2, 1, 10) }' <<<"$runs" |
    sort -u | grep -c . || true)"

echo "fuzz soak: $repo, last $nights scheduled run(s)"
if [ -n "$runs" ]; then
    awk -F'\t' '{ printf "  %-9s %s  %s\n", $1, substr($2, 1, 10), $3 }' <<<"$runs"
fi

# Volume: the sum of target time across green runs. `gh` does not expose
# per-job durations, so wall-clock × job count is used — the same figure for a
# matrix whose jobs run in parallel, and never an overestimate.
soak_minutes=0
while read -r run_id started finished; do
    [ -z "$run_id" ] && continue
    jobs="$(gh run view "$run_id" --repo "$repo" --json jobs \
        --jq '[.jobs[] | select(.conclusion == "success")] | length')"
    [ "$jobs" -eq 0 ] && continue
    soak_minutes=$(( soak_minutes + $(python3 -c '
import sys
from datetime import datetime
start, end = (datetime.fromisoformat(value.replace("Z", "+00:00")) for value in sys.argv[1:3])
print(max(0, int((end - start).total_seconds())) * int(sys.argv[3]) // 60)
' "$started" "$finished" "$jobs") ))
done < <(gh run list --repo "$repo" --workflow fuzz.yml --limit 40 \
    --json databaseId,conclusion,createdAt,updatedAt \
    --jq '.[] | select(.conclusion == "success") | "\(.databaseId) \(.createdAt) \(.updatedAt)"')

echo "  volume: ${soak_minutes} of ${minutes} target-minute(s)"

if [ "$green" -ge "$nights" ] && [ "$distinct_days" -ge "$nights" ]; then
    echo "ok   $green/$nights consecutive scheduled runs green on $distinct_days distinct days"
    exit 0
fi
if [ "$soak_minutes" -ge "$minutes" ]; then
    echo "ok   $soak_minutes target-minute(s) of green soak (criterion: $minutes)"
    exit 0
fi

echo "open $green/$nights scheduled runs green ($distinct_days distinct days), $soak_minutes/$minutes target-minutes" >&2
if [ "$total" -lt "$nights" ]; then
    echo "     $((nights - total)) more night(s) have to run, or $((minutes - soak_minutes)) more target-minute(s) of soak" >&2
fi
if [ "$green" -lt "$total" ]; then
    echo "     a scheduled run did not succeed: the nights count restarts from the last green night" >&2
fi
exit 1
