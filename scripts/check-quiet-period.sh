#!/usr/bin/env bash
# Fail when a versioned surface moved after the quiet period started.
#
# ADR 0006 says 1.0 may only be cut from a commit where the two previous minor
# releases changed no versioned surface. That is easy to claim at audit time and
# easy to break without noticing, so it is checked here: once 0.5 has shipped,
# the modules that define `Report`, the plugin protocol, the config schema and
# the container format must not change again before 1.0.
#
# Set ALLOW_SURFACE_CHANGE (in the workflow, which makes it a reviewed diff) to
# accept a change anyway. Per the ADR, that restarts the counter.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Files that carry a frozen contract. Anything that defines bytes on disk or a
# structure another program parses belongs here.
surfaces=(
    crates/core/src/report.rs
    crates/core/src/config.rs
    crates/sidecar/src/main.rs
    crates/crypto/src/container.rs
)

# The first release that is required to be quiet. Before it, surface work is
# expected; from it on, the countdown to 1.0 has started.
quiet_from_minor=5

minor_of() {
    # v0.5.2 -> 5, 0.12.0 -> 12, anything unparsable -> empty
    sed -n 's/^v\{0,1\}0\.\([0-9]\+\)\..*$/\1/p' <<<"$1"
}

tags="$(git tag --list 'v[0-9]*' --sort='-v:refname')"
if [ -z "$tags" ]; then
    echo "no release tags yet: the quiet period cannot be evaluated" >&2
    exit 0
fi

newest="$(head -1 <<<"$tags")"
newest_minor="$(minor_of "$newest")"
if [ -z "$newest_minor" ]; then
    echo "cannot parse a minor version out of $newest" >&2
    exit 1
fi

if [ "$newest_minor" -lt "$quiet_from_minor" ]; then
    echo "newest release is $newest: surface work is still expected, quiet period" \
         "starts after v0.${quiet_from_minor}.0 (ADR 0006)"
    exit 0
fi

for f in "${surfaces[@]}"; do
    if [ ! -e "$f" ]; then
        echo "surface file is gone: $f" >&2
        exit 1
    fi
done

fail=0

report() {
    local range="$1" label="$2" changed
    changed="$(git diff --name-only "$range" -- "${surfaces[@]}")"
    if [ -z "$changed" ]; then
        printf '  ok   %s\n' "$label"
        return
    fi
    fail=1
    printf '  MOVED %s\n' "$label"
    sed 's/^/         /' <<<"$changed"
}

echo "quiet period: surfaces frozen since v0.${quiet_from_minor}.0"
report "$newest..HEAD" "since $newest (this build)"

# Release-time evidence: the stretches the ADR actually counts.
mapfile -t tag_array <<<"$tags"
for ((i = 0; i < 2 && i + 1 < ${#tag_array[@]}; i++)); do
    newer="${tag_array[i]}"
    older="${tag_array[i + 1]}"
    # Both ends must be quiet releases: the stretch before v0.5.0 is where the
    # surface work happened, and it is not what the ADR counts.
    if [ "$(minor_of "$older")" -ge "$quiet_from_minor" ]; then
        report "$older..$newer" "$older..$newer"
    fi
done

if [ "$fail" -ne 0 ]; then
    if [ -n "${ALLOW_SURFACE_CHANGE:-}" ]; then
        cat >&2 <<EOF

A versioned surface changed. Accepting it because ALLOW_SURFACE_CHANGE is set:
  $ALLOW_SURFACE_CHANGE

Per ADR 0006 this restarts the two-release counter, so 1.0 is now at least two
quiet minor releases away. Record the change in CHANGELOG.md under "Changed".
EOF
        exit 0
    fi
    cat >&2 <<'EOF'

A versioned surface changed during the quiet period, so 1.0 cannot be cut from
this commit. Either revert it, or - if it is a deliberate change - restart the
counter: say why in ALLOW_SURFACE_CHANGE in .github/workflows/ci.yml and
CHANGELOG.md. Surfaces are listed in docs/adr/0006-what-1.0-promises.md.
EOF
    exit 1
fi

echo "no versioned surface moved"
