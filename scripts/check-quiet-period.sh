#!/usr/bin/env bash
# Fail when a versioned surface moved after the quiet period started.
#
# ADR 0006 counts *releases*: 1.0 may only be cut from a commit where the two
# previous minor releases changed no versioned surface. The countdown restarts
# whenever a deliberate break ships (ADR 0008 did exactly that), so the gate
# needs to know which release the current countdown started from.
#
#   restart_release   the release that last restarted the countdown
#
# Three states, and only one of them is green-by-default:
#
#   1. newest tag < restart_release   the break is in flight. Surface work is
#      expected here, so this reports it and passes. Nothing is silently
#      accepted: it says which release ends the state.
#   2. newest tag >= restart_release  the countdown is running. Any change to a
#      frozen surface since that release fails, unless ALLOW_SURFACE_CHANGE
#      names a reason — which is how a *new* deliberate break restarts it again.
#   3. ALLOW_SURFACE_CHANGE set while nothing moved  a stale waiver. That is a
#      check no longer checking, so it fails and asks for the variable to go.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Files that carry a frozen contract. Anything that defines bytes on disk or a
# structure another program parses belongs here.
surfaces=(
    packages/core/src/report.ts
    packages/core/src/config.ts
    packages/core/src/manifest.ts
    packages/engine/src/container.ts
    packages/engine/src/keystore.ts
    packages/engine/src/keys.ts
    docs/CONTAINER.md
)

# The release that restarted the countdown. Move this in the same commit that
# tags a release which deliberately changed a surface.
restart_release="0.8.0"

# Numeric comparison of `vX.Y.Z` / `X.Y.Z`; prints -1, 0, or 1.
compare() {
    local left="${1#v}" right="${2#v}"
    local a b i
    IFS=. read -r -a a <<<"$left"
    IFS=. read -r -a b <<<"$right"
    for i in 0 1 2; do
        local x="${a[i]:-0}" y="${b[i]:-0}"
        case "$x" in ''|*[!0-9]*) echo "cannot parse a version out of '$1'" >&2; exit 1 ;; esac
        case "$y" in ''|*[!0-9]*) echo "cannot parse a version out of '$2'" >&2; exit 1 ;; esac
        if [ "$x" -lt "$y" ]; then echo -1; return; fi
        if [ "$x" -gt "$y" ]; then echo 1; return; fi
    done
    echo 0
}

tags="$(git tag --list 'v[0-9]*' --sort='-v:refname')"
if [ -z "$tags" ]; then
    echo "no release tags yet: the quiet period cannot be evaluated" >&2
    exit 0
fi
newest="$(head -1 <<<"$tags")"

if [ "$(compare "$newest" "$restart_release")" -lt 0 ]; then
    cat <<EOF
quiet period: not enforcing yet
  newest release is $newest; the countdown restarted at v$restart_release (ADR 0008)
  surface work is expected until v$restart_release is tagged. From that tag on,
  this check fails on any change to a frozen surface, so it is safe to require.
EOF
    if [ -n "${ALLOW_SURFACE_CHANGE:-}" ]; then
        echo "  note: ALLOW_SURFACE_CHANGE is set but unnecessary before v$restart_release" >&2
    fi
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

echo "quiet period: surfaces frozen since v$restart_release"
report "$newest..HEAD" "since $newest (this build)"

# Release-time evidence: the stretches the ADR actually counts.
mapfile -t tag_array <<<"$tags"
for ((i = 0; i < 2 && i + 1 < ${#tag_array[@]}; i++)); do
    newer="${tag_array[i]}"
    older="${tag_array[i + 1]}"
    # Both ends must be inside the current countdown; the stretch that carried
    # the break is not what the ADR counts.
    if [ "$(compare "$older" "$restart_release")" -ge 0 ]; then
        report "$older..$newer" "$older..$newer"
    fi
done

if [ "$fail" -ne 0 ]; then
    if [ -n "${ALLOW_SURFACE_CHANGE:-}" ]; then
        cat >&2 <<EOF

A versioned surface changed. Accepting it because ALLOW_SURFACE_CHANGE is set:
  $ALLOW_SURFACE_CHANGE

Per ADR 0006 this restarts the two-release counter: tag the release that ships
the break, move \`restart_release\` in this script to it, and remove
ALLOW_SURFACE_CHANGE. Record the change in CHANGELOG.md under "Changed".
EOF
        exit 0
    fi
    cat >&2 <<'EOF'

A versioned surface changed during the quiet period, so 1.0 cannot be cut from
this commit. Either revert it, or - if it is a deliberate change - say why in
ALLOW_SURFACE_CHANGE in .github/workflows/ci.yml, then follow the restart
procedure it prints. Surfaces are listed in
docs/adr/0006-what-1.0-promises.md.
EOF
    exit 1
fi

if [ -n "${ALLOW_SURFACE_CHANGE:-}" ]; then
    cat >&2 <<'EOF'

ALLOW_SURFACE_CHANGE is set, but no versioned surface moved since the last
release. A waiver that is never needed stops the check from checking anything,
so remove it from .github/workflows/ci.yml.
EOF
    exit 1
fi

echo "no versioned surface moved"
