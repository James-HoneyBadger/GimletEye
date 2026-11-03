#!/usr/bin/env bash
# Lay out an installed tree: the one definition of what a package contains.
#
# The three packaging recipes (deb, rpm, Arch) each call this with their own
# build root, so they cannot drift from each other or from the layout the CLI
# looks for at run time:
#
#   usr/bin/gimlet-works                    the primary command
#   usr/bin/gimlet                          the compatibility alias
#   usr/lib/gimlet-works/cli/{bin,dist}     the command line
#   usr/lib/gimlet-works/core/{dist,package.json}
#   usr/lib/gimlet-works/engine/{dist,package.json}
#   usr/lib/gimlet-works/node_modules/...    the runtime dependencies
#   usr/share/doc/gimlet-works/             README, CHANGELOG, licence, docs
#
# Usage: scripts/stage-package.sh <root>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${1:?usage: stage-package.sh <root>}"
cd "$root"

die() { printf '\033[31mstage-package: %s\033[0m\n' "$*" >&2; exit 1; }

lib="$dest/usr/lib/gimlet-works"
doc="$dest/usr/share/doc/gimlet-works"

[ -f packages/cli/dist/main.js ] || die "build the CLI first: npm run build"
[ -f packages/core/dist/index.js ] || die "build the core first: npm run build"
[ -f packages/engine/dist/index.js ] || die "build the engine first: npm run build"
[ -d node_modules/smol-toml ] || die "install the dependencies first: npm ci"

install -d "$lib/cli" "$lib/core" "$lib/engine" "$lib/node_modules/@gimlet-works" \
    "$lib/node_modules/@noble" "$dest/usr/bin" "$doc"

cp -r packages/cli/dist "$lib/cli/dist"
cp -r packages/cli/bin "$lib/cli/bin"
cp packages/cli/package.json "$lib/cli/package.json"

cp -r packages/core/dist "$lib/core/dist"
cp packages/core/package.json "$lib/core/package.json"

cp -r packages/engine/dist "$lib/engine/dist"
cp packages/engine/package.json "$lib/engine/package.json"

cp -r node_modules/smol-toml "$lib/node_modules/smol-toml"
[ -d node_modules/@noble/hashes ] || die "install the dependencies first: npm ci"
cp -r node_modules/@noble/hashes "$lib/node_modules/@noble/hashes"
ln -sfn ../../core "$lib/node_modules/@gimlet-works/core"
ln -sfn ../../engine "$lib/node_modules/@gimlet-works/engine"

ln -sfn ../lib/gimlet-works/cli/bin/gimlet-works "$dest/usr/bin/gimlet-works"
ln -sfn ../lib/gimlet-works/cli/bin/gimlet "$dest/usr/bin/gimlet"

for file in README.md CHANGELOG.md LICENSE; do
    install -m 0644 "$file" "$doc/$file"
done
for file in docs/CONTAINER.md docs/COMPATIBILITY.md docs/USER_GUIDE.md docs/ADMIN_GUIDE.md; do
    install -m 0644 "$file" "$doc/$(basename "$file")"
done

printf 'staged %s\n' "$dest"
