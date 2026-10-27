#!/usr/bin/env bash
# Lay out an installed tree: the one definition of what a package contains.
#
# The three packaging recipes (deb, rpm, Arch) each call this with their own
# build root, so they cannot drift from each other or from the layout the CLI
# looks for at run time:
#
#   usr/bin/gimlet                    -> ../lib/gimlet/cli/bin/gimlet
#   usr/lib/gimlet/cli/bin/gimlet     the entry point
#   usr/lib/gimlet/cli/{bin,dist}     the command line
#   usr/lib/gimlet/core/{dist,package.json}
#   usr/lib/gimlet/gimlet-sidecar     the engine (found by walking up from core/)
#   usr/lib/gimlet/node_modules/...   the one runtime dependency
#   usr/share/doc/gimlet/             README, CHANGELOG, licence, docs
#
# Usage: scripts/stage-package.sh <root>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${1:?usage: stage-package.sh <root>}"
cd "$root"

die() { printf '\033[31mstage-package: %s\033[0m\n' "$*" >&2; exit 1; }

lib="$dest/usr/lib/gimlet"
doc="$dest/usr/share/doc/gimlet"

[ -f target/release/gimlet-sidecar ] || die "build the engine first: cargo build --release -p gimlet-eye-sidecar"
[ -f packages/cli/dist/main.js ] || die "build the CLI first: npm run build"
[ -f packages/core/dist/index.js ] || die "build the core first: npm run build"
[ -d node_modules/smol-toml ] || die "instal the dependencies first: npm ci"

install -d "$lib/cli" "$lib/core" "$lib/node_modules/@gimlet-eye" "$dest/usr/bin" "$doc"

install -m 0755 target/release/gimlet-sidecar "$lib/gimlet-sidecar"

cp -r packages/cli/dist "$lib/cli/dist"
cp -r packages/cli/bin "$lib/cli/bin"
cp packages/cli/package.json "$lib/cli/package.json"

cp -r packages/core/dist "$lib/core/dist"
cp packages/core/package.json "$lib/core/package.json"

cp -r node_modules/smol-toml "$lib/node_modules/smol-toml"
ln -sfn ../../core "$lib/node_modules/@gimlet-eye/core"

ln -sfn ../lib/gimlet/cli/bin/gimlet "$dest/usr/bin/gimlet"

for file in README.md CHANGELOG.md LICENSE; do
    install -m 0644 "$file" "$doc/$file"
done
for file in docs/CONTAINER.md docs/COMPATIBILITY.md docs/USER_GUIDE.md docs/ADMIN_GUIDE.md; do
    install -m 0644 "$file" "$doc/$(basename "$file")"
done

printf 'staged %s\n' "$dest"
