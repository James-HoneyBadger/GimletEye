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

step "metadata strip round trip"
work="$MELLIVORA_HOME/work"
mkdir -p "$work"
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

step "audit trail records no values"
cli passgen length=12 count=1 --format json >/dev/null
cli audit --limit 5 --format json | grep -q '"arg_keys"' || fail "audit trail missing entries"
if cli audit --limit 5 --format json | grep -q 'passwords'; then
    fail "audit trail leaked an argument value"
fi

step "perl den pack"
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
for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:$port/api/v1/health" >/dev/null 2>&1 && break
    sleep 0.25
done
curl -sf "http://127.0.0.1:$port/api/v1/health" >/dev/null || fail "API did not start"
curl -sf -X POST "http://127.0.0.1:$port/api/v1/run" \
    -H 'content-type: application/json' \
    -d '{"tool":"disk-usage","args":{}}' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["tool"]=="sysadmin.disk-usage", d'
echo "API ok"

printf '\n\033[32msmoke test passed\033[0m\n'
