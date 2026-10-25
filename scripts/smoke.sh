#!/usr/bin/env bash
# End-to-end smoke test: CLI, HTTP API, and the Perl Den pack.
#
# Requires: cargo, curl, and (for the pack section) a Perl Den checkout in
# external/. Run ./scripts/link-sources.sh first.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

export MELLIVORA_HOME="$(mktemp -d)"
port="${SMOKE_PORT:-7899}"
server_pid=""

cleanup() {
    if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
    rm -rf "$MELLIVORA_HOME"
}
trap cleanup EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

step "build"
cargo build -q -p mellivora-cli

cli() { ./target/debug/mellivora "$@"; }

step "tool catalogue"
count=$(cli tools list --format json | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
[ "$count" -ge 7 ] || fail "expected at least 7 tools, got $count"
echo "$count tools registered"

step "native sysadmin tool"
cli system-info --format json | python3 -c '
import json, sys
report = json.load(sys.stdin)
assert report["tool"] == "sysadmin.system-info", report["tool"]
assert report["status"] in ("ok", "warning"), report["status"]
data = report["data"]
assert "hostname" in data and "cpu" in data, sorted(data)
print("summary:", report["summary"])
'

step "disk usage csv"
cli disk-usage --format csv | head -3

step "crypto tools"
cli passgen length=24 count=1 --format json | python3 -c '
import json, sys
report = json.load(sys.stdin)
password = report["data"]["passwords"][0]
assert len(password) == 24, password
print("generated", len(password), "char password")
'
test_digest=$(cli sha256 text=abc --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["sha256"])')
[ "$test_digest" = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" ] \
    || fail "sha256 known-answer mismatch"

step "encryption and signatures"
work="$MELLIVORA_HOME/work"
mkdir -p "$work"
export MELLIVORA_SMOKE_PASS="smoke-test-passphrase"
printf 'the launch code is 0000\n' > "$work/secret.txt"

cli crypto.encrypt input="$work/secret.txt" passphrase_env=MELLIVORA_SMOKE_PASS >/dev/null
[ -f "$work/secret.txt.melv" ] || fail "encrypt produced no container"

cli crypto.inspect input="$work/secret.txt.melv" --format json | python3 -c '
import json, sys
report = json.load(sys.stdin)
data = report["data"]
assert data["algorithm"] == "chacha20-poly1305", data
assert data["container_version"] == 2, data
assert data["streaming"] is True, data
assert data["ciphertext_bytes"] > 0, data
print("container:", report["summary"])
'

cli crypto.decrypt input="$work/secret.txt.melv" output="$work/decrypted.txt" \
    passphrase_env=MELLIVORA_SMOKE_PASS >/dev/null
cmp -s "$work/secret.txt" "$work/decrypted.txt" || fail "decrypted file does not match the original"

# A wrong passphrase must fail instead of writing garbage.
if MELLIVORA_SMOKE_PASS=wrong cli crypto.decrypt input="$work/secret.txt.melv" \
    output="$work/bad.txt" passphrase_env=MELLIVORA_SMOKE_PASS >/dev/null 2>&1; then
    fail "decrypt should fail with a wrong passphrase"
fi

cli crypto.keygen label=smoke dir="$work/keys" >/dev/null
cli crypto.sign input="$work/secret.txt" key="$work/keys/smoke.key" >/dev/null
cli crypto.verify input="$work/secret.txt" signature="$work/secret.txt.sig" \
    key="$work/keys/smoke.pub" >/dev/null || fail "signature did not verify"

printf 'tampered\n' >> "$work/secret.txt"
if cli crypto.verify input="$work/secret.txt" signature="$work/secret.txt.sig" \
    key="$work/keys/smoke.pub" >/dev/null 2>&1; then
    fail "verify should fail on a modified file"
fi

step "metadata strip round trip"
python3 - "$work/photo.jpg" <<'PY'
import struct, sys
path = sys.argv[1]
exif = b"Exif\x00\x00GPS-LEAK"
data = b"\xff\xd8"
data += b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif
data += b"\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00" + b"\x01\x02\x03\x04" + b"\xff\xd9"
open(path, "wb").write(data)
PY
cli metadata-scan input="$work/photo.jpg" --format json | grep -q '"metadata_bytes": [1-9]' \
    || fail "scan did not detect EXIF"
cli metadata-strip input="$work/photo.jpg" --format json >/dev/null
[ -f "$work/photo.clean.jpg" ] || fail "strip produced no output"
cli metadata-verify input="$work/photo.clean.jpg" --format json | grep -q '"status": "ok"' \
    || fail "stripped file is not clean"

step "privacy profiles and GPS redaction"
python3 - "$work/gps.jpg" <<'PYGEN'
import struct, sys

def rational(value):
    return struct.pack(">II", int(value * 1_000_000), 1_000_000)

def gps_exif(lat, lon, alt):
    gps_off = 26
    data = 26 + 2 + 5 * 12 + 4
    tiff = b"MM" + struct.pack(">H", 42) + struct.pack(">I", 8)
    tiff += struct.pack(">H", 1) + struct.pack(">HHI", 0x8825, 4, 1) + struct.pack(">I", gps_off)
    tiff += struct.pack(">I", 0)
    tiff += struct.pack(">H", 5)
    tiff += struct.pack(">HHI", 1, 2, 2) + b"N\x00\x00\x00"
    tiff += struct.pack(">HHI", 2, 5, 3) + struct.pack(">I", data)
    tiff += struct.pack(">HHI", 3, 2, 2) + b"W\x00\x00\x00"
    tiff += struct.pack(">HHI", 4, 5, 3) + struct.pack(">I", data + 24)
    tiff += struct.pack(">HHI", 6, 5, 1) + struct.pack(">I", data + 48)
    tiff += struct.pack(">I", 0)
    assert len(tiff) == data
    for part in lat:
        tiff += rational(part)
    for part in lon:
        tiff += rational(part)
    tiff += rational(alt)
    return b"Exif\x00\x00" + tiff

exif = gps_exif((51, 30, 26.46), (0, 7, 39.93), 35.0)
jpeg = b"\xff\xd8" + b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif
jpeg += b"\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00" + b"\x01\x02\x03\x04" + b"\xff\xd9"
open(sys.argv[1], "wb").write(jpeg)
PYGEN

# archive + redact keeps EXIF and coarsens the coordinates
cli metadata-strip input="$work/gps.jpg" profile=archive redact_gps=city --format json \
    | python3 -c '
import json, sys
report = json.load(sys.stdin)
gps = report["data"]["gps"]
assert gps["latitude"] == 51.5, gps
assert gps["longitude"] == -0.12, gps
assert report["data"]["removed_bytes"] == 0, report["data"]
print("redacted to", gps["precision"], "->", gps["latitude"], gps["longitude"])
'
python3 - "$work/gps.clean.jpg" <<'PYCHK'
import sys
data = open(sys.argv[1], "rb").read()
assert b"Exif" in data, "EXIF should survive GPS redaction"
PYCHK

# the redacted file still carries metadata, so the privacy profile must flag it
if cli metadata-verify input="$work/gps.clean.jpg" --format json >/dev/null; then
    fail "verify should report remaining metadata under the privacy profile"
fi
cli metadata-verify input="$work/gps.clean.jpg" profile=archive --format json >/dev/null \
    || fail "archive profile should accept the redacted file"

# --strict promotes warnings to a non-zero exit for CI
if cli --strict metadata-scan input="$work/gps.jpg" >/dev/null 2>&1; then
    fail "--strict should fail on a warning"
fi

step "batch execution"
batchdir="$work/batch"
mkdir -p "$batchdir/nested"
printf 'one' > "$batchdir/one.txt"
printf 'two' > "$batchdir/two.txt"
printf 'three' > "$batchdir/nested/three.txt"

cli batch crypto.sha256 "$batchdir" --input-arg path --concurrency 2 --format json | python3 -c '
import json, sys
report = json.load(sys.stdin)
assert report["status"] == "ok", report["summary"]
data = report["data"]
assert data["total"] == 3, data
assert data["ok"] == 3, data
assert len(data["files"]) == 3, data
print("batch:", report["summary"])
'
# A missing file must fail the batch, not be skipped silently.
if cli batch crypto.sha256 "$batchdir" --input-arg path --ext missing >/dev/null 2>&1; then
    fail "batch should fail when nothing matches"
fi

step "audit trail records no values"
cli passgen length=12 count=1 --format json >/dev/null
cli audit --limit 5 --format json | grep -q '"arg_keys"' || fail "audit trail missing entries"
if cli audit --limit 5 --format json | grep -q 'passwords'; then
    fail "audit trail leaked an argument value"
fi

step "compatibility pack"
if [ -d external/Perl_Den/lib/PerlDen/Scripts ]; then
    pack_tools=$(cli tools list --format json | python3 -c '
import json, sys
print(sum(1 for tool in json.load(sys.stdin) if tool["origin"] == "plugin:perlden"))
')
    [ "$pack_tools" -ge 20 ] || fail "expected 20 pack tools, got $pack_tools"
    cli run perlden.system-info --format json | python3 -c '
import json, sys
report = json.load(sys.stdin)
assert report["tool"] == "perlden.system-info", report["tool"]
assert report["body"], "expected the formatted report in body"
print("pack tool summary:", report["summary"])
'
    echo "$pack_tools pack tools live"
else
    echo "skipped: run ./scripts/link-sources.sh to enable the Perl Den pack"
fi

step "http api"
./target/debug/mellivora serve --port "$port" >"$MELLIVORA_HOME/server.log" 2>&1 &
server_pid=$!

token_file="$MELLIVORA_HOME/api-token"
for _ in $(seq 1 40); do
    [ -s "$token_file" ] && curl -sf -H "authorization: Bearer $(cat "$token_file")" \
        "http://127.0.0.1:$port/api/v1/health" >/dev/null 2>&1 && break
    sleep 0.25
done
[ -s "$token_file" ] || fail "serve created no API token"
token=$(cat "$token_file")

mode=$(python3 -c 'import os,stat,sys; print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode))[2:])' "$token_file")
[ "$mode" = "600" ] || fail "API token file mode is $mode, expected 600"

# The token is the boundary: no credential, no answer.
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/health")
[ "$code" = "401" ] || fail "expected 401 without a token, got $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer nope' \
    "http://127.0.0.1:$port/api/v1/health")
[ "$code" = "401" ] || fail "expected 401 for a wrong token, got $code"

auth=(-H "authorization: Bearer $token")
curl -sf "${auth[@]}" "http://127.0.0.1:$port/api/v1/health" >/dev/null || fail "API did not start"
curl -sf -X POST "${auth[@]}" "http://127.0.0.1:$port/api/v1/run" \
    -H 'content-type: application/json' \
    -d '{"tool":"disk-usage","args":{}}' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["tool"]=="sysadmin.disk-usage", d'
curl -sf "${auth[@]}" "http://127.0.0.1:$port/api/v1/audit?limit=5" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["enabled"] and d["entries"], d'
echo "API ok (token required, mode 0600, 401 without it)"

printf '\n\033[32msmoke test passed\033[0m\n'
