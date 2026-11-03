#!/usr/bin/env bash
# The packaging files must name the version the CLI actually reports.
#
# A release that ships a PKGBUILD or a .spec with a stale version produces a
# package whose name lies about its contents, and it is the kind of drift that
# only shows up after the artifact is published. Checked here, on every build.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# The version has one home: the constant the CLI prints. `packages/*/package.json`
# copies it for npm's benefit, and this reads the real one.
version="$(sed -n "s/^export const VERSION = '\(.*\)';$/\1/p" packages/core/src/version.ts | head -1)"
if [ -z "$version" ]; then
    echo "no version in packages/core/src/version.ts" >&2
    exit 1
fi

fail=0

# The workspace root is private and publishes nothing, but it now carries a
# version: `npm sbom` refuses to describe a package it cannot give a purl to, and
# the SBOM is a release artifact. So every manifest is compared, root included.
for manifest in package.json packages/cli/package.json packages/core/package.json \
                packages/engine/package.json apps/desktop/package.json; do
    declared="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$manifest" | head -1)"
    if [ "$declared" != "$version" ]; then
        printf 'STALE   %s: %s (version.ts says %s)\n' "$manifest" "${declared:-<none>}" "$version" >&2
        fail=1
    fi
done

check() {
    local file="$1" pattern="$2" found
    if [ ! -f "$file" ]; then
        printf 'MISSING %s\n' "$file" >&2
        fail=1
        return
    fi
    found="$(sed -n "$pattern" "$file" | head -1)"
    if [ "$found" != "$version" ]; then
        printf 'STALE   %s: %s (version.ts says %s)\n' "$file" "${found:-<none>}" "$version" >&2
        fail=1
    else
        printf 'ok      %s %s\n' "$file" "$found"
    fi
}

check packaging/arch/PKGBUILD      's/^pkgver=\(.*\)$/\1/p'
check packaging/fedora/gimlet-works-toolkit.spec 's/^Version: *\(.*\)$/\1/p'
check debian/changelog             's/^gimlet-works-toolkit (\([0-9][0-9.]*\)[^)]*) .*$/\1/p'

# The Debian package name and the Arch package name are allowed to differ, but
# both must install the same binary name - that is what users type.
grep -q '^Package: gimlet-works$' debian/control || {
    echo "debian/control must ship a package named 'gimlet-works'" >&2
    fail=1
}
grep -q '^Package: gimlet$' debian/control || {
    echo "debian/control must retain the transitional 'gimlet' package" >&2
    fail=1
}
# The shared staging script installs in /usr/lib even on lib64 distributions.
for path in '%{_prefix}/lib/gimlet-works' '%{_docdir}/gimlet-works'; do
    grep -Fxq "$path" packaging/fedora/gimlet-works-toolkit.spec || {
        echo "the RPM file list must include $path" >&2
        fail=1
    }
done
# The three recipes must all stage through one script, because three
# hand-written install sections drift the moment one of them is edited.
for recipe in debian/rules packaging/arch/PKGBUILD packaging/fedora/gimlet-works-toolkit.spec; do
    grep -q 'scripts/stage-package.sh' "$recipe" || {
        echo "$recipe must install through scripts/stage-package.sh" >&2
        fail=1
    }
done

node <<'NODE' || fail=1
const desktop = require('./apps/desktop/package.json');
const build = desktop.build;
const expected = ['--replaces=gimlet-eye', '--conflicts=gimlet-eye', '--provides=gimlet-eye'];
if (desktop.productName !== 'Gimlet Works' ||
    build.appId !== 'dev.gimletworks.desktop' ||
    build.nsis.guid !== '38f02069-fb9a-59a7-9e5c-f022bf2bf607' ||
    !expected.every((option) => build.deb.fpm.includes(option))) {
  console.error('desktop installer branding or upgrade metadata is missing');
  process.exitCode = 1;
}
NODE

if [ "$fail" -ne 0 ]; then
    cat >&2 <<EOF

Packaging metadata is inconsistent. Correct the failures above before release.
EOF
    exit 1
fi

printf '\nall packaging names version %s\n' "$version"
