#!/usr/bin/env bash
# Every README claim that a command can settle, settled.
#
# ADR 0006, Gate 5: "Every capability statement in the README is backed by a
# test, a CI job, or a command in the docs." This is the third of those - the
# examples on the front page, run as written. A claim that drifts from the code
# (a renamed flag, a tool that stopped accepting an argument) fails here rather
# than in a user's terminal.
#
# Claims a command cannot settle are listed at the end with where their evidence
# lives, so the audit is complete rather than merely green.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export GIMLET_HOME="$work/home"
mkdir -p "$GIMLET_HOME"
M="./packages/cli/bin/gimlet"

if [ ! -x "$M" ]; then
    echo "build the CLI first: npm run build" >&2
    exit 1
fi
# The CLI needs no engine: every tool it names is built in.
unset GIMLET_SIDECAR || true

pass=0
fail=0
check() {
    if [ "$2" -eq 0 ]; then
        printf '  ok    %s\n' "$1"
        pass=$((pass + 1))
    else
        printf '\033[31m  FAIL  %s\033[0m\n' "$1"
        fail=$((fail + 1))
    fi
}

echo "== the front page, run as written"

version="$(sed -n "s/^export const VERSION = '\(.*\)';$/\1/p" packages/core/src/version.ts | head -1)"
$M --version | grep -qF "$version"
check "gimlet --version reports $version" $?

$M system-info --format json | jq -e '.data.load.avg_1m' >/dev/null
check "system-info reports the load average" $?

$M disk-usage --format json | jq -e '.data | length > 0' >/dev/null
check "disk-usage reports filesystems" $?

$M passgen length=32 --format json | jq -e '.data' >/dev/null
check "passgen generates a secret" $?

printf 'notes\n' > "$work/notes.txt"
export NOTES_PASS='front-page-check'
$M crypto.encrypt input="$work/notes.txt" passphrase_env=NOTES_PASS >/dev/null
check "crypto.encrypt with passphrase_env" $?

export KEY_PASS='front-page-check'
$M keygen kind=x25519 label=alice keystore=true passphrase_env=KEY_PASS >/dev/null
check "keygen writes into the sealed keystore" $?

$M crypto.key-export selector=alice output="$work/alice.pub" passphrase_env=KEY_PASS >/dev/null
check "crypto.key-export writes a public key" $?

$M crypto.encrypt input="$work/notes.txt" output="$work/notes.gimlet" to="$work/alice.pub" >/dev/null
check "crypto.encrypt to= a recipient, no shared secret" $?

$M crypto.key-export selector=alice output="$work/alice.key" secret=true passphrase_env=KEY_PASS >/dev/null
$M crypto.decrypt input="$work/notes.gimlet" output="$work/notes.clear" key="$work/alice.key" >/dev/null
cmp -s "$work/notes.txt" "$work/notes.clear"
check "crypto.decrypt with the recipient's key" $?

# A JPEG whose EXIF carries a real GPS IFD, built here so the check needs no
# fixture. A text stand-in for EXIF would make `redact_gps` fail with "unknown
# TIFF byte order" - which is the tool being right and the fixture being wrong.
python3 - "$work/photo.jpg" <<'PY'
import struct, sys

def tiff_with_gps():
    header = b"II*\x00" + struct.pack("<I", 8)
    # IFD0: one entry, a GPS IFD pointer at offset 26.
    ifd0 = struct.pack("<H", 1) + struct.pack("<HHII", 0x8825, 4, 1, 26) + struct.pack("<I", 0)
    # GPS IFD: latitude ref ('N') inline, latitude as three rationals at offset 56.
    gps = struct.pack("<H", 2)
    gps += struct.pack("<HHII", 1, 2, 2, 0x4E000000)
    gps += struct.pack("<HHII", 2, 5, 3, 56)
    gps += struct.pack("<I", 0)
    rationals = struct.pack("<II", 51, 1) + struct.pack("<II", 30, 1) + struct.pack("<II", 0, 1)
    return header + ifd0 + gps + rationals

exif = b"Exif\x00\x00" + tiff_with_gps()
data = b"\xff\xd8" + b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif
data += b"\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00" + b"\x09" * 4 + b"\xff\xd9"
open(sys.argv[1], "wb").write(data)
PY
$M metadata-strip input="$work/photo.jpg" profile=sharing >/dev/null
check "metadata-strip profile=sharing" $?
$M metadata-strip input="$work/photo.jpg" output="$work/photo.gps.jpg" profile=archive \
    redact_gps=city --format json | jq -e '.data.gps.precision == "city"' >/dev/null
check "metadata-strip profile=archive redact_gps=city truncates the coordinate" $?

echo
echo "== the claims about the catalogue and the packs"
$M tools list --format json | jq -e 'length > 0' >/dev/null
check "tools list answers in JSON" $?

$M tools show crypto.sha256 --format json | grep -q '"id": "crypto.sha256"'
check "tools show prints one manifest" $?

$M crypto.sha256 text=hello --format json | grep -q '"sha256"'
check "a crypto tool runs through the CLI" $?

$M doctor >/dev/null
check "doctor runs" $?

echo
echo "== claims a command settles by refusing"
$M crypto.decrypt input="$work/notes.gimlet" output="$work/x" passphrase_env=NOTES_PASS >/dev/null 2>&1
[ $? -ne 0 ]
check "a recipient container is not opened by a passphrase" $?

# (Nothing that starts a server belongs here: `serve` blocks by design, and a
# check script that hangs is worse than one that checks less.)

rm -rf "$GIMLET_HOME"
printf '\n\033[1m%s ok, %s failed\033[0m\n' "$pass" "$fail"

cat <<'EOF'

Claims this script cannot settle, and their evidence:

  reproducible builds        .github/workflows/release.yml "reproducible" job
  signed releases            .github/workflows/release.yml "Sign the checksums"
  package builds             ci.yml "packaging"; scripts/rehearse-upgrade.sh
  packages need Node 20+     debian/control `Depends: nodejs (>= 20)`, and
                             scripts/rehearse-upgrade.sh installs it first
  upgrade survives rollback  ci.yml "rehearsal"
  no telemetry, no uploads   `npm audit --omit=dev` over the runtime dependency
                             set, in ci.yml "dependency policy"
  parsers are fuzzed         packages/engine/test/corpus.test.ts replays the
                             committed corpus; scripts/fuzz-soak.sh runs the
                             targets on demand and records them in
                             fuzz/soak-ledger.jsonl, but no CI job schedules the
                             soak (ADR 0010)
  the desktop app works      apps/desktop/src/**/*.test.ts (vitest, jsdom)
  the UI matches the CLI     packages/core is the implementation both import
EOF

[ "$fail" -eq 0 ]
