#!/usr/bin/env bash
# Report, in one place, whether 1.0 may be cut.
#
# ADR 0006 gates the release on five things and an audit of each. Every mechanism
# exists — the quiet-period diff, the MSRV build, the conformance runner, the
# soak history, the claims check — but they live in different scripts and
# different CI jobs, so "are we there yet" was an exercise in remembering all of
# them. This runs what can be run now, reads the CI history for what cannot, and
# says plainly which rows are waiting on elapsed time or on a human.
#
# Three states, and the difference matters:
#   ok     verified just now
#   ci     verified by the newest CI run on main, which must be green for that job
#   open   not satisfied yet, with the reason
#
# Exit status is 1 only when something is broken (a check failed) or when --strict
# is given and anything is open, so this can sit in CI without being red until the
# day it should be.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

strict=0
skip_ci=0
for argument in "$@"; do
    case "$argument" in
        --strict) strict=1 ;;
        --no-ci) skip_ci=1 ;;
        *)
            echo "unknown argument: $argument" >&2
            exit 2
            ;;
    esac
done

open_rows=0
broken=0

row() {
    # row <gate> <state> <label> <detail>
    printf '  %-2s %-4s %-46s %s\n' "$1" "$2" "$3" "$4"
    case "$2" in
        open) open_rows=$((open_rows + 1)) ;;
        fail) broken=$((broken + 1)) ;;
    esac
}

# A failing local check is a regression; a missing tool is not the same thing.
#
# A `cargo test <filter>` that matches nothing still exits 0, which is how a gate
# row can look green while proving nothing. The number of tests that actually ran
# is summed from every target's summary line, and zero is a failure.
run_check() {
    # run_check <gate> <label> <command...>
    local gate="$1" label="$2" is_cargo=0
    shift 2
    [ "$1" = "cargo" ] && is_cargo=1
    local output status passed
    output="$("$@" 2>&1)"
    status=$?

    if [ "$status" -ne 0 ]; then
        row "$gate" fail "$label" "$(grep -E '^(test result: FAILED|error)' <<<"$output" | head -1)"
        return
    fi
    if [ "$is_cargo" -eq 0 ]; then
        # A script either did its job or exited non-zero; there is no test count.
        row "$gate" ok "$label" "$(tail -1 <<<"$output")"
        return
    fi
    passed="$(sed -n 's/^test result: ok\. \([0-9]\+\) passed.*/\1/p' <<<"$output" |
        awk '{ total += $1 } END { print total + 0 }')"
    if [ "$passed" -eq 0 ]; then
        row "$gate" fail "$label" "matched no tests: the row would be vacuous"
    else
        row "$gate" ok "$label" "$passed test(s)"
    fi
}

# CI results come from the newest run on main, so a red job here means the
# evidence is absent right now, not that it was ever wrong.
declare -A ci_state=()
declare -A ci_note=()
loaded_ci=0

load_ci() {
    [ "$loaded_ci" -eq 1 ] && return
    loaded_ci=1
    if [ "$skip_ci" -eq 1 ] || ! command -v gh >/dev/null; then
        return
    fi
    # The newest run may still be queued, which says nothing about the evidence;
    # the last *completed* run on main is what the gate is about.
    local run
    run="$(gh run list --workflow ci.yml --branch main --limit 8 --json databaseId,status,conclusion \
        --jq '[.[] | select(.status == "completed")][0] | "\(.databaseId)\t\(.status)\t\(.conclusion // "-")"' 2>/dev/null)"
    [ -z "$run" ] || [ "$run" = "null" ] && return
    local id status conclusion
    IFS=$'\t' read -r id status conclusion <<<"$run"
    while IFS=$'\t' read -r name result; do
        ci_state["$name"]="$result"
        ci_note["$name"]="run $id"
    done < <(gh run view "$id" --json jobs \
        --jq '.jobs[] | "\(.name)\t\(.conclusion // .status)"' 2>/dev/null)
    CI_RUN_ID="$id"
    CI_RUN_STATUS="$status"
    CI_RUN_CONCLUSION="$conclusion"
}

ci_row() {
    # ci_row <gate> <job name> <label>
    local gate="$1" job="$2" label="$3"
    load_ci
    if [ -z "${ci_state[$job]:-}" ]; then
        row "$gate" open "$label" "no CI result for '$job' (run with gh available)"
        return
    fi
    local state="${ci_state[$job]}"
    case "$state" in
        success) row "$gate" ok "$label" "CI: $job" ;;
        *) row "$gate" fail "$label" "CI job '$job' is $state in ${ci_note[$job]}" ;;
    esac
}

echo "Mellivora ToolKit — release gate report"
echo

echo "Gate 1 — the pillars we already claim are finished"
run_check 1 "keystore: sealed storage, zeroize, wrong passphrase" \
    cargo test --quiet -p mellivora-crypto keystore
run_check 1 "container: v1 and v3 fixtures still open" \
    cargo test --quiet -p mellivora-crypto --test container_compat
run_check 1 "key exchange: OpenPGP interop against real gpg" \
    env MELLIVORA_REQUIRE_GPG=1 cargo test --quiet -p mellivora-crypto --test gpg_interop
run_check 1 "key exchange: a .melv a second implementation can read" \
    env MELLIVORA_REQUIRE_SECOND_IMPL=1 cargo test --quiet -p mellivora-crypto --test second_implementation
ci_row 1 "integration (CLI, API, Perl pack)" "platform contract and pack behaviour"
run_check 1 "format coverage: golden corpus round-trips" \
    cargo test --quiet -p mellivora-scrub --test golden_corpus
echo

echo "Gate 2 — safety evidence for the destructive paths"
load_ci
if [ -n "${CI_RUN_ID:-}" ]; then
    if [ "${CI_RUN_CONCLUSION:-}" = "success" ]; then
        row 2 ok "CI on main is green" "run $CI_RUN_ID"
    else
        row 2 open "CI on main is green" "run $CI_RUN_ID is ${CI_RUN_CONCLUSION:-$CI_RUN_STATUS}"
    fi
else
    row 2 open "CI on main is green" "no gh, or no run: pass --no-ci to ignore"
fi
fuzz_output="$(./scripts/check-fuzz-nights.sh 2>&1)"
if [ $? -eq 0 ]; then
    row 2 ok "fuzz soak: seven nights or 350 target-minutes" "$(tail -1 <<<"$fuzz_output")"
else
    row 2 open "fuzz soak: seven nights or 350 target-minutes" "$(tail -1 <<<"$fuzz_output")"
fi
ci_row 2 "integration (CLI, API, Perl pack)" "API token, pack trust, conformance"
ci_row 2 "dependency policy" "cargo deny on both graphs"
ci_row 2 "msrv (declared rust-version)" "the declared MSRV actually builds"
ci_row 2 "e2e (live engine, Playwright)" "the UI against a live engine"
ci_row 2 "rehearsal (install, upgrade, roll back)" "install, upgrade, rollback in a container"
echo

echo "Gate 3 — the freeze"
run_check 3 "no versioned surface moved since the last release" ./scripts/check-quiet-period.sh
run_check 3 "every command, flag, and route documented as public" ./scripts/check-public-surface.sh
for doc in docs/COMPATIBILITY.md docs/CONTAINER.md docs/PLUGIN_SDK.md docs/USER_GUIDE.md \
    docs/ADMIN_GUIDE.md docs/PACK_GALLERY.md; do
    if [ -s "$doc" ]; then
        row 3 ok "$(printf '%-42s' "$doc")" "$(wc -l <"$doc" | tr -d ' ') lines"
    else
        row 3 fail "$doc is missing" ""
    fi
done
echo

echo "Gate 4 — distribution"
ci_row 4 "packaging (version agreement, deb build)" "packaging files agree with the version"
if [ -n "$(git tag --list 'v0.7*')" ]; then
    release_state="$(gh run list --workflow release.yml --limit 1 --json conclusion \
        --jq '.[0].conclusion // "running"' 2>/dev/null || echo unknown)"
    case "$release_state" in
        success) row 4 ok "release workflow publishes signed artifacts" "last run succeeded" ;;
        *) row 4 open "release workflow publishes signed artifacts" "last run: ${release_state:-unknown}" ;;
    esac
else
    row 4 open "release workflow publishes signed artifacts" "no tag to release"
fi
if [ -n "${MINISIGN_PUBLIC_KEY:-}" ] || grep -rqs 'untrusted comment' --include='*.pub' .; then
    row 4 ok "signing key is published" "public key present"
else
    row 4 open "signing key is published" "needs you: minisign -G, then commit the public half"
fi
echo

echo "Gate 5 — documentation"
ci_row 5 "claims (the README, run as written)" "every README claim has evidence"
if [ -d examples/packs/hostname ]; then
    row 5 ok "pack gallery: a pack beyond Perl Den" "examples/packs/hostname"
else
    row 5 fail "pack gallery: a pack beyond Perl Den" "examples/packs/hostname is missing"
fi
echo

echo "summary: $broken broken, $open_rows open"
if [ "$broken" -gt 0 ]; then
    exit 1
fi
if [ "$strict" -eq 1 ] && [ "$open_rows" -gt 0 ]; then
    exit 1
fi
exit 0
