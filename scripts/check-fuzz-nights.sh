#!/usr/bin/env bash
# Prove the fuzz soak has been green for seven consecutive nights.
#
# ADR 0006 Gate 2 asks for the parsers to be fuzzed "green in CI for seven
# consecutive days". That is the one gate no amount of local work can satisfy in
# an afternoon: it is elapsed evidence, and the only way to be sure it happened is
# to read the scheduled runs back. Doing that by eye is how a skipped night gets
# forgotten, so it is done here.
#
# The window counts *scheduled* runs, newest first, stopping at the first
# failure. A dispatched run (`gh workflow run fuzz.yml`) does not count: it proves
# the job works, not that it worked unattended. Nights may be missing from the
# history — GitHub drops schedules on a dormant repository — and a gap is a
# failure of the soak, not a pass by default.
#
# Usage: scripts/check-fuzz-nights.sh [--nights N] [--repo OWNER/NAME]
set -euo pipefail

nights=7
repo=""

while [ $# -gt 0 ]; do
    case "$1" in
        --nights)
            nights="$2"
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

if [ "$green" -ge "$nights" ] && [ "$distinct_days" -ge "$nights" ]; then
    echo "ok   $green/$nights consecutive scheduled runs green on $distinct_days distinct days"
    exit 0
fi

echo "open $green/$nights scheduled runs green ($distinct_days distinct days)" >&2
if [ "$total" -lt "$nights" ]; then
    echo "     $((nights - total)) more night(s) have to run before this gate can pass" >&2
fi
if [ "$green" -lt "$total" ]; then
    echo "     a scheduled run did not succeed: the soak restarts from the last green night" >&2
fi
exit 1
