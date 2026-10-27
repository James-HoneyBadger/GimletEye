#!/usr/bin/env bash
# End-to-end: the command line against real files.
#
# Everything here runs the shipped code path — the CLI resolves a tool, the tool
# performs it, the report is rendered, and the audit trail records it. Nothing is
# stubbed or imported directly from a test file, which is the point: this is the
# only check that proves the pieces a user gets agree with each other.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export GIMLET_HOME="$work/home"
export NOTES_PASS="smoke-passphrase"
export KEY_PASS="smoke-key-passphrase"

CLI="$root/packages/cli/bin/gimlet"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31msmoke: %s\033[0m\n' "$*" >&2; exit 1; }

[ -x "$CLI" ] || fail "build the CLI first: npm run build"
command -v node >/dev/null || fail "node 20+ is required"

step "the catalogue"
count="$("$CLI" tools list --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).length))')"
[ "$count" -ge 19 ] || fail "expected at least 19 tools, got $count"
printf '   %s tools\n' "$count"
"$CLI" tools show sysadmin.system-info >/dev/null || fail "tools show"

step "a host tool, in this language"
"$CLI" system-info --format json | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const report = JSON.parse(d);
  if (report.status === "error") { console.error("system-info failed"); process.exit(1); }
  if (!report.data.hostname && !report.data.kernel) { console.error("no host data"); process.exit(1); }
});'
printf '   ok\n'

step "an engine tool"
hash="$("$CLI" crypto.sha256 text=hello --format json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.sha256))')"
[ "$hash" = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" ] || fail "sha256 mismatch: $hash"
printf '   sha256 ok\n'

step "encrypt and decrypt round trip"
printf 'secret payload\n' > "$work/notes.txt"
"$CLI" crypto.encrypt input="$work/notes.txt" passphrase_env=NOTES_PASS >/dev/null
[ -f "$work/notes.txt.gimlet" ] || fail "no container written"
"$CLI" crypto.decrypt input="$work/notes.txt.gimlet" passphrase_env=NOTES_PASS output="$work/round.txt" >/dev/null
cmp -s "$work/notes.txt" "$work/round.txt" || fail "round trip differs"
printf '   round trip ok\n'

step "a wrong passphrase fails and is recorded"
if "$CLI" crypto.decrypt input="$work/notes.txt.gimlet" passphrase=wrong output="$work/x.txt" 2>/dev/null; then
    fail "decryption with the wrong passphrase succeeded"
fi
"$CLI" audit --limit 5 --format json | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const entries = JSON.parse(d);
  if (!entries.some((entry) => entry.status === "error")) { console.error("no error record"); process.exit(1); }
  for (const entry of entries) {
    if (JSON.stringify(entry).includes("smoke-passphrase")) { console.error("a value leaked into the trail"); process.exit(1); }
  }
});'
printf '   audit ok\n'

step "keystore"
"$CLI" crypto.keygen label=smoke kind=x25519 keystore=true passphrase_env=KEY_PASS >/dev/null
[ -f "$GIMLET_HOME/keystore.gimlet" ] || fail "no keystore written"
"$CLI" crypto.key-list passphrase_env=KEY_PASS --format json | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  const keys = JSON.parse(d).data.keys;
  if (!keys.some((key) => key.label === "smoke")) { console.error("key missing"); process.exit(1); }
});'
printf '   keystore ok\n'

step "metadata"
cp packages/engine/test/fixtures/photo-exif-gps.jpg "$work/photo.jpg"
"$CLI" metadata-scan input="$work/photo.jpg" >/dev/null
"$CLI" metadata-strip input="$work/photo.jpg" output="$work/clean.jpg" >/dev/null
"$CLI" metadata-verify input="$work/clean.jpg" >/dev/null
printf '   scan, strip, verify ok\n'

step "batch"
mkdir -p "$work/batch"
cp packages/engine/test/fixtures/photo-exif-gps.jpg "$work/batch/a.jpg"
cp packages/engine/test/fixtures/photo-exif-gps.jpg "$work/batch/b.jpg"
"$CLI" batch metadata-scan "$work/batch" --fail-fast > "$work/batch.txt"
grep -q "2 of 2 file(s)" "$work/batch.txt" || fail "batch summary missing"
printf '   batch ok\n'

step "configuration"
"$CLI" config init >/dev/null
if "$CLI" config init 2>/dev/null; then fail "config init overwrote without --force"; fi
"$CLI" config path | grep -q "config.toml" || fail "config path"
"$CLI" config show | grep -q "schema_version" || fail "config show"
printf '   config ok\n'

step "doctor"
"$CLI" doctor | grep -q "engine" || fail "doctor did not mention the engine"
printf '   doctor ok\n'

step "exit codes"
"$CLI" crypto.sha256 text 2>/dev/null && fail "a usage error must exit non-zero"
code=0
"$CLI" crypto.sha256 text >/dev/null 2>&1 || code=$?
[ "$code" -eq 2 ] || fail "usage error should exit 2, got $code"
printf '   exit codes ok\n'

printf '\n\033[32msmoke: everything passed\033[0m\n'
