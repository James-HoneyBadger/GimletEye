#!/usr/bin/env bash
# The three packaging files must name the version the binary actually reports.
#
# A release that ships a PKGBUILD or a .spec with a stale version produces a
# package whose name lies about its contents, and it is the kind of drift that
# only shows up after the artifact is published. Checked here, on every build.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

version="$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)"
if [ -z "$version" ]; then
    echo "no version in [workspace.package] of Cargo.toml" >&2
    exit 1
fi

fail=0

check() {
    local file="$1" pattern="$2" found
    if [ ! -f "$file" ]; then
        printf 'MISSING %s\n' "$file" >&2
        fail=1
        return
    fi
    found="$(sed -n "$pattern" "$file" | head -1)"
    if [ "$found" != "$version" ]; then
        printf 'STALE   %s: %s (Cargo.toml says %s)\n' "$file" "${found:-<none>}" "$version" >&2
        fail=1
    else
        printf 'ok      %s %s\n' "$file" "$found"
    fi
}

check packaging/arch/PKGBUILD      's/^pkgver=\(.*\)$/\1/p'
check packaging/fedora/mellivora-toolkit.spec 's/^Version: *\(.*\)$/\1/p'
check debian/changelog             's/^mellivora-toolkit (\(.*\)) .*$/\1/p'

# The Debian package name and the Arch package name are allowed to differ, but
# both must install the same binary name - that is what users type.
grep -q '^Package: mellivora$' debian/control || {
    echo "debian/control must ship a package named 'mellivora'" >&2
    fail=1
}
grep -q 'usr/bin/mellivora' debian/rules || {
    echo "debian/rules must install usr/bin/mellivora" >&2
    fail=1
}

if [ "$fail" -ne 0 ]; then
    cat >&2 <<EOF

Packaging is out of step with the workspace version ($version).

Update the version in every file above in the same commit that bumps Cargo.toml.
EOF
    exit 1
fi

printf '\nall packaging names version %s\n' "$version"
