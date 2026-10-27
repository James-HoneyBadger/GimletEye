#!/usr/bin/env bash
# Break the code on purpose and check the tests notice.
#
# Eight real gaps in this project were found this way, after the suite was green:
# an untested keystore mode, an unbounded recipient count, an Argon2 budget nobody
# checked, a GPS test that asserted on the report instead of the bytes, a second
# EXIF block read back by nothing, and three guards the port had dropped. Reading
# a test cannot tell you whether it can fail; breaking the code can.
#
# Each row is: file | original text | replacement | test to run | expected.
#
#   caught    the mutation must make the test fail
#   survived  the mutation must leave it passing (a control: proves a green result
#             is not just the runner being broken)
#
# Usage: scripts/mutation-check.sh [--only <substring>]
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

only=""
if [ "${1:-}" = "--only" ]; then
    only="${2:?--only needs a substring}"
fi

if [ ! -x node_modules/.bin/vitest ]; then
    echo "mutation-check: install the dependencies first: npm ci" >&2
    exit 2
fi

backup="$(mktemp -d)"
trap 'restore_all; rm -rf "$backup"' EXIT
declare -a touched=()

restore_all() {
    for file in "${touched[@]:-}"; do
        [ -f "$backup/$(printf '%s' "$file" | tr '/' '_')" ] &&
            cp "$backup/$(printf '%s' "$file" | tr '/' '_')" "$file"
    done
}

caught=0
survived=0
escaped=0
stale=0

mutate() {
    local file="$1" from="$2" to="$3" test="$4" expect="$5" label="$6"
    if [ -n "$only" ] && [[ "$label" != *"$only"* ]]; then
        return
    fi

    local saved="$backup/$(printf '%s' "$file" | tr '/' '_')"
    [ -f "$saved" ] || { cp "$file" "$saved"; touched+=("$file"); }

    if ! FROMS="$from" TOS="$to" python3 - "$file" <<'PY'
import os, pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
old, new = os.environ['FROMS'], os.environ['TOS']
if text.count(old) != 1:
    sys.exit(3)
path.write_text(text.replace(old, new, 1))
PY
    then
        printf '  %-46s STALE (pattern not found exactly once)\n' "$label"
        stale=$((stale + 1))
        cp "$saved" "$file"
        return
    fi

    local result
    if timeout 600 ./node_modules/.bin/vitest run "$test" >/dev/null 2>&1; then
        result=survived
    else
        result=caught
    fi
    cp "$saved" "$file"

    if [ "$result" = "$expect" ]; then
        printf '  %-46s %s\n' "$label" "$result"
        if [ "$result" = "caught" ]; then caught=$((caught + 1)); else survived=$((survived + 1)); fi
    else
        printf '  %-46s ESCAPED (expected %s, got %s)\n' "$label" "$expect" "$result"
        escaped=$((escaped + 1))
    fi
}

echo "mutation-check: breaking the code to see whether the tests care"
echo

# ── the container ─────────────────────────────────────────────────────────────
mutate packages/engine/src/container.ts \
    "nonce[4 + byte] = (nonce[4 + byte] as number) ^ (counter[byte] as number);" \
    "nonce[4 + byte] = nonce[4 + byte] as number;" \
    packages/engine/test/container.test.ts caught "chunk nonce ignores its index"

mutate packages/engine/src/container.ts \
    "if (length < TAG_LEN || length > MAX_CHUNK_CIPHERTEXT) {
        throw new ContainerError(\`chunk \${this.index} declares an impossible length \${length}\`);" \
    "if (length < TAG_LEN) {
        throw new ContainerError(\`chunk \${this.index} declares an impossible length \${length}\`);" \
    packages/engine/test/container.test.ts caught "chunk length ceiling removed"

mutate packages/engine/src/container.ts \
    "if (count < 1 || count > MAX_RECIPIENTS) {
      throw new ContainerError(\`recipient count \${count} is outside the accepted range\`);" \
    "if (false) {
      throw new ContainerError(\`recipient count \${count} is outside the accepted range\`);" \
    packages/engine/test/container.test.ts caught "recipient count unbounded"

mutate packages/core/src/tools/containers.ts \
    "const READ_WINDOW = 1024 * 1024;" \
    "const READ_WINDOW = 1024 * 1024; // a window, not the file" \
    packages/core/test/containers.test.ts survived "(control) a comment must not fail anything"

# ── the keystore ──────────────────────────────────────────────────────────────
mutate packages/engine/src/keystore.ts \
    "await chmod(path, 0o600);" \
    "await chmod(path, 0o644);" \
    packages/engine/test/keystore-file.test.ts caught "keystore left group/world readable"

mutate packages/engine/src/keystore.ts \
    "  const sealed = seal(store, passphrase);" \
    "  const sealed = Buffer.from(encode(store));" \
    packages/engine/test/keystore-file.test.ts caught "keystore stored as plaintext JSON"

# ── the metadata scrub ────────────────────────────────────────────────────────
mutate packages/engine/src/scrub/format.ts \
    "export const REMOVABLE: readonly SegmentCategory[] = ['identity', 'text', 'time'];" \
    "export const REMOVABLE: readonly SegmentCategory[] = ['identity', 'text', 'time', 'structural'];" \
    packages/engine/test/scrub.test.ts caught "structural segments become removable"

mutate packages/engine/src/scrub/gps.ts \
    "const seconds = Math.round(Math.abs(degrees) * 3600);" \
    "const seconds = Math.trunc(Math.abs(degrees) * 3600);" \
    packages/engine/test/gps.test.ts caught "grid rounding reverted (fuzz-found bug)"

mutate packages/engine/src/scrub/gps.ts \
    "    writeDms(payload, base + plan.longitudeOffset, plan.longitude, gridSeconds, plan.little);" \
    "    writeDms(payload, base + plan.longitudeOffset, plan.longitude, gridSeconds * 3, plan.little);" \
    packages/engine/test/gps.test.ts caught "longitude snapped on a coarser grid"

mutate packages/engine/src/scrub/gps.ts \
    "    writeDms(payload, base + plan.latitudeOffset, plan.latitude, gridSeconds, plan.little);" \
    "    writeDms(payload, plan.latitudeOffset, plan.latitude, gridSeconds, plan.little);" \
    packages/engine/test/gps.test.ts caught "latitude written at the wrong offset (the port's own bug)"

mutate packages/engine/src/scrub/gps.ts \
    "  refuseUnsafeWrites(plan);" \
    "  void 0;" \
    packages/engine/test/gps.test.ts caught "shared-bytes refusal removed"

# ── the tools ─────────────────────────────────────────────────────────────────
mutate packages/core/src/tools/guard.ts \
    "    throw invalidArgs(\`output \${target} is the input file; choose another path\`);" \
    "    return;" \
    packages/core/test/containers.test.ts caught "distinct-path guard removed"

mutate packages/core/src/tools/metadata.ts \
    "const input = await resolveInput(ctx, requested);" \
    "const input = requested;" \
    packages/core/test/metadata-strip.test.ts caught "symlink no longer followed"

mutate packages/core/src/tools/containers.ts \
    "  if (memoryKib <= BUDGET_MEMORY_KIB && timeCost <= BUDGET_ITERATIONS) return;" \
    "  if (memoryKib <= BUDGET_MEMORY_KIB) return;" \
    packages/core/test/containers.test.ts caught "iteration budget ignored"

mutate packages/core/src/audit.ts \
    "    await this.host.appendTextFile(this.path, \`\${JSON.stringify(entry)}\\n\`);" \
    "    const existing = await this.readAll();
    existing.push(entry);
    await this.writeAll(prune(existing, this.maxEntries));" \
    packages/core/test/state.test.ts caught "audit rewrites instead of appending"

mutate packages/core/src/tools/containers.ts \
    "const READ_WINDOW = 1024 * 1024;" \
    "const READ_WINDOW = 64 * 1024 * 1024;" \
    packages/core/test/containers.test.ts caught "read window widened past the bound"

mutate packages/core/src/audit.ts \
    "  async tail(limit: number): Promise<AuditEntry[]> {" \
    "  async tail(limit: number): Promise<AuditEntry[]> {
    void 0;" \
    packages/core/test/state.test.ts survived "(control) a no-op statement must not fail"

# ── the surface ───────────────────────────────────────────────────────────────
mutate packages/cli/src/output.ts \
    "  if (format === 'json') {" \
    "  if (false) {" \
    packages/cli/test/cli.test.ts caught "failures stop being machine-readable"

echo
printf 'mutation-check: %s caught, %s survived as controls, %s escaped, %s stale\n' \
    "$caught" "$survived" "$escaped" "$stale"

if [ "$escaped" -ne 0 ]; then
    echo "mutation-check: a mutation the tests did not notice is a missing test" >&2
    exit 1
fi
if [ "$stale" -ne 0 ]; then
    echo "mutation-check: a mutation no longer applies; update the table" >&2
    exit 1
fi
