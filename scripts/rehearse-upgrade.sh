#!/usr/bin/env bash
# Install, upgrade, and roll back in a clean container, carrying real state.
#
# The thing worth proving is not that `dpkg -i` works. It is that the files a user
# cannot afford to lose - the sealed keystore and the audit trail - survive an
# upgrade and a rollback, with their permissions intact and the keystore still
# openable by the binary that came back.
#
# Two packages are built from this tree: `old` at the current version, and `new`
# with the patch number bumped, so the sequence is a genuine version change rather
# than a reinstall of the same thing.
#
#   ./scripts/rehearse-upgrade.sh
#
# Needs docker. On a machine without it the run is skipped unless
# REQUIRE_REHEARSAL=1, so a developer laptop is not blocked but CI is not fooled.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

IMAGE="${REHEARSAL_IMAGE:-debian:bookworm-slim}"
work="$(mktemp -d)"
# The container builds as root, so its files arrive root-owned; hand them back
# before deleting or the trap fails and leaves the tree behind.
cleanup() {
    if [ -d "$work" ]; then
        docker run --rm -v "$work:/w" "$IMAGE" chown -R "$(id -u):$(id -g)" /w >/dev/null 2>&1 || true
        rm -rf "$work"
    fi
}
trap cleanup EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    if [ "${REQUIRE_REHEARSAL:-0}" = "1" ]; then
        fail "docker is required for the upgrade rehearsal"
    fi
    echo "SKIPPED: docker is not available; set REQUIRE_REHEARSAL=1 to make this an error"
    exit 0
fi

version="$(sed -n "s/^export const VERSION = '\(.*\)';$/\1/p" packages/core/src/version.ts | head -1)"
next="${version%.*}.$(( ${version##*.} + 1 ))"
echo "old = $version, new = $next"

# ── stage two source trees ────────────────────────────────────────────────────
step "stage the two versions"
# The working tree, not `git archive HEAD`: the packaging files being rehearsed
# are usually the uncommitted part, and a rehearsal that cannot see them would
# test the previous commit.
for kind in old new; do
    mkdir -p "$work/$kind"
    tar -C "$root" \
        --exclude=.git --exclude=target --exclude=node_modules \
        --exclude=dist --exclude=external --exclude=test-results \
        -cf - . | tar -xf - -C "$work/$kind"
done
# The version lives in one constant; the npm manifests copy it for their own
# benefit, and the packaging files are checked against it.
python3 - "$work/new" "$next" <<'PY'
import json, pathlib, re, sys
root, next_version = pathlib.Path(sys.argv[1]), sys.argv[2]

constant = root / "packages/core/src/version.ts"
constant.write_text(re.sub(r"^export const VERSION = '.*';$",
                           f"export const VERSION = '{next_version}';",
                           constant.read_text(), count=1, flags=re.M))

for manifest in ["packages/cli/package.json", "packages/core/package.json",
                 "packages/engine/package.json", "apps/desktop/package.json"]:
    path = root / manifest
    data = json.loads(path.read_text())
    data["version"] = next_version
    path.write_text(json.dumps(data, indent=2) + "\n")

changelog = root / "debian/changelog"
changelog.write_text(re.sub(r'^gimlet-eye-toolkit \([^)]*\)',
                            f'gimlet-eye-toolkit ({next_version})',
                            changelog.read_text(), count=1, flags=re.M))

for recipe, pattern in [("packaging/arch/PKGBUILD", r'^pkgver=.*$'),
                        ("packaging/fedora/gimlet-eye-toolkit.spec", r'^Version: .*$')]:
    path = root / recipe
    replacement = "pkgver=" + next_version if recipe.endswith("PKGBUILD") else "Version:        " + next_version
    path.write_text(re.sub(pattern, replacement, path.read_text(), count=1, flags=re.M))
PY
for kind in old new; do
    rm -rf "$work/$kind/packaging/arch" # makepkg is irrelevant inside Debian
done
echo "staged $work"

# ── build both .debs in a container ───────────────────────────────────────────
step "build the packages"
docker run --rm -v "$work:/w" -w /w "$IMAGE" bash -euc '
    apt-get update -qq
    apt-get install -y -qq build-essential debhelper curl ca-certificates >/dev/null
    # The package is TypeScript: the build needs Node 20 and npm, and nothing else.
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
    for kind in old new; do
        cd "/w/$kind"
        # `-d` skips the build-dependency check on purpose: the container
        # installs the toolchain by hand rather than through apt.
        dpkg-buildpackage -b -uc -us -d >/tmp/$kind.log 2>&1 || { tail -30 /tmp/$kind.log; exit 1; }
        # `gimlet_*.deb` is the binary package; a `-dbgsym` build is not it.
        mv /w/gimlet_[0-9]*.deb "/w/$kind.deb"
        echo "built $kind"
    done
' || fail "the package build failed"

ls -l "$work"/*.deb

# ── the rehearsal itself ──────────────────────────────────────────────────────
step "install, use, upgrade, roll back"
docker run --rm -v "$work:/w" -e OLD=/w/old.deb -e NEW=/w/new.deb \
    -e VERSION="$version" -e NEXT="$next" "$IMAGE" bash -euc '
    export DEBIAN_FRONTEND=noninteractive
    # Nothing below may contain a single quote: this whole block is one quoted
    # argument, and an apostrophe ends it early. Use \" for inner quoting.
    # python3 is for this harness (parsing a report), not for the package. Node is
    # a real dependency: the distro nodejs is 18 and the package needs 20.
    apt-get update -qq && apt-get install -y -qq python3 curl ca-certificates >/dev/null
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
    node --version | grep -qE "^v(2[0-9]|[3-9][0-9])" || { echo "the package needs node 20 or newer"; exit 1; }
    export GIMLET_HOME=/home/tester/.config/gimlet
    export KEEP_PASS=rehearsal-passphrase
    useradd -m tester >/dev/null 2>&1 || true

    install_as_tester() { su tester -s /bin/bash -c "$*"; }

    echo "--- install $VERSION"
    dpkg -i "$OLD" >/dev/null
    su tester -s /bin/bash -c "gimlet --version"

    echo "--- create state with $VERSION"
    su tester -s /bin/bash -c "
        set -e
        export GIMLET_HOME=$GIMLET_HOME KEEP_PASS=$KEEP_PASS
        gimlet crypto.keygen label=survivor kind=x25519 keystore=true passphrase_env=KEEP_PASS >/dev/null
        gimlet crypto.sha256 text=before >/dev/null
        test -f \$GIMLET_HOME/keystore.gimlet
        test -f \$GIMLET_HOME/audit.jsonl
    "
    key_id_before=$(su tester -s /bin/bash -c "
        export GIMLET_HOME=$GIMLET_HOME KEEP_PASS=$KEEP_PASS
        gimlet crypto.key-list passphrase_env=KEEP_PASS --format json | python3 -c "import json,sys; print(json.load(sys.stdin)[\"data\"][\"keys\"][0][\"id\"])"
    ")
    mode_before=$(stat -c %a "/home/tester/.config/gimlet/keystore.gimlet")
    entries_before=$(wc -l < /home/tester/.config/gimlet/audit.jsonl)
    echo "key id $key_id_before, keystore mode $mode_before, $entries_before audit entries"

    echo "--- upgrade to $NEXT"
    dpkg -i "$NEW" >/dev/null
    su tester -s /bin/bash -c "gimlet --version" | grep -q "$NEXT" || { echo "version did not change"; exit 1; }

    key_id_after=$(su tester -s /bin/bash -c "
        export GIMLET_HOME=$GIMLET_HOME KEEP_PASS=$KEEP_PASS
        gimlet crypto.key-list passphrase_env=KEEP_PASS --format json | python3 -c "import json,sys; print(json.load(sys.stdin)[\"data\"][\"keys\"][0][\"id\"])"
    ")
    [ "$key_id_after" = "$key_id_before" ] || { echo "the keystore changed across the upgrade"; exit 1; }
    su tester -s /bin/bash -c "
        export GIMLET_HOME=$GIMLET_HOME
        gimlet crypto.sha256 text=during >/dev/null
    "
    echo "keystore opens after upgrade; key id unchanged"

    echo "--- roll back to $VERSION"
    dpkg -i "$OLD" >/dev/null
    su tester -s /bin/bash -c "gimlet --version" | grep -q "$VERSION" || { echo "rollback did not restore the version"; exit 1; }

    mode_after=$(stat -c %a "/home/tester/.config/gimlet/keystore.gimlet")
    [ "$mode_after" = "$mode_before" ] || { echo "keystore permissions changed: $mode_before -> $mode_after"; exit 1; }

    entries_after=$(wc -l < /home/tester/.config/gimlet/audit.jsonl)
    [ "$entries_after" -gt "$entries_before" ] || { echo "the audit trail lost entries across the round trip"; exit 1; }
    echo "$entries_after audit entries after the round trip"

    echo "--- upgrade again, and the state still opens"
    dpkg -i "$NEW" >/dev/null
    key_id_final=$(su tester -s /bin/bash -c "
        export GIMLET_HOME=$GIMLET_HOME KEEP_PASS=$KEEP_PASS
        gimlet crypto.key-list passphrase_env=KEEP_PASS --format json | python3 -c "import json,sys; print(json.load(sys.stdin)[\"data\"][\"keys\"][0][\"id\"])"
    ")
    [ "$key_id_final" = "$key_id_before" ] || { echo "the keystore did not survive the second upgrade"; exit 1; }
    echo "rehearsal passed"
' || fail "the install/upgrade/rollback rehearsal failed"

step "done"
echo "installed, upgraded $version → $next, rolled back, and upgraded again;"
echo "the keystore kept its key id and its 0600 mode, and the audit trail kept growing."
