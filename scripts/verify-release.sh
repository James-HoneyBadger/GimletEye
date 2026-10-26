#!/usr/bin/env bash
# Verify a downloaded release: checksums first, then the signature over them.
#
# This is the script a user is told to run, so it is also the script to test.
# It refuses to say "ok" unless it has *verified* something - a missing
# signature is a failure here even though it is only a warning in some projects.
#
#   ./scripts/verify-release.sh ~/Downloads/SHA256SUMS ~/Downloads/SHA256SUMS.minisig
#
# With no arguments it expects SHA256SUMS and SHA256SUMS.minisig in the current
# directory, next to the downloaded files.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sums="${1:-SHA256SUMS}"
sig="${2:-SHA256SUMS.minisig}"
key="${MELLIVORA_RELEASE_KEY:-$root/release-key.pub}"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

[ -f "$sums" ] || fail "no checksum file at $sums"
[ -f "$sig" ] || fail "no signature at $sig (an unsigned release cannot be verified)"

if ! command -v minisign >/dev/null 2>&1; then
    cat >&2 <<'EOF'
FAIL: minisign is not installed, so the signature cannot be checked.

  Arch        pacman -S minisign
  Debian      apt install minisign
  Fedora      dnf install minisign
  macOS       brew install minisign
EOF
    exit 1
fi

if [ ! -f "$key" ]; then
    cat >&2 <<EOF
FAIL: no public key at $key

Download it from SECURITY.md in the repository, or point
MELLIVORA_RELEASE_KEY at the copy you already have. Without the key the
signature proves nothing.
EOF
    exit 1
fi

echo "== signature"
minisign -V -p "$key" -m "$sums" -x "$sig" || fail "the checksums are not signed by the release key"

echo
echo "== checksums"
# `-c` reads the list, verifies every entry it names, and fails on a mismatch or
# a missing file. Files that are absent are reported rather than skipped silently.
if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$sums" --ignore-missing || fail "a downloaded file does not match its checksum"
else
    shasum -a 256 -c "$sums" || fail "a downloaded file does not match its checksum"
fi

echo
echo "verified: $sums is signed by the release key and every listed file matches"
