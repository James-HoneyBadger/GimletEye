#!/usr/bin/env bash
# Put the engine beside the shell so a packaged app can find it.
#
# The window no longer needs a webview to compile, but until ADR 0010 reaches
# stage 4 the engine is still `gimlet-sidecar`. The main process points
# `GIMLET_SIDECAR` at this copy when the app is packaged, because a installed
# app cannot rely on the environment.
#
# Usage: scripts/stage-engine.sh [--release]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

profile="debug"
[ "${1:-}" = "--release" ] && profile="release"

source_bin="target/$profile/gimlet-sidecar"
dest_dir="apps/desktop/electron/bin"

[ -x "$source_bin" ] || {
    printf 'stage-engine: no %s; build it first: cargo build %s-p gimlet-eye-sidecar\n' \
        "$source_bin" "${profile/release/--release }" >&2
    exit 1
}

install -d "$dest_dir"
install -m 0755 "$source_bin" "$dest_dir/gimlet-sidecar"
printf 'staged %s -> %s\n' "$source_bin" "$dest_dir/gimlet-sidecar"
