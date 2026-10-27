#!/usr/bin/env bash
# Put the engine where Tauri's bundler expects an `externalBin` to be.
#
# `tauri.conf.json` declares `binaries/gimlet-sidecar`, and Tauri resolves that to
# `binaries/gimlet-sidecar-<target-triple>` — validating it while the app builds,
# not only when bundling. So `cargo check`, `tauri dev`, and `tauri build` all
# need the file staged first, with the triple in its name.
#
# Usage: scripts/stage-tauri-engine.sh [--release]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

profile="debug"
cargo_flags=()
if [ "${1:-}" = "--release" ]; then
    profile="release"
    cargo_flags=(--release)
fi

triple="$(rustc -vV | sed -n 's/^host: //p')"
[ -n "$triple" ] || { echo "cannot determine the host target triple" >&2; exit 1; }

cargo build ${cargo_flags[@]+"${cargo_flags[@]}"} --locked -p gimlet-eye-sidecar

name="gimlet-sidecar"
[ -f "target/$profile/$name" ] || name="gimlet-sidecar.exe"
[ -f "target/$profile/$name" ] || { echo "no engine built at target/$profile" >&2; exit 1; }

mkdir -p apps/desktop/src-tauri/binaries
install -m 0755 "target/$profile/$name" "apps/desktop/src-tauri/binaries/gimlet-sidecar-$triple"
printf 'staged the engine as binaries/gimlet-sidecar-%s\n' "$triple"
