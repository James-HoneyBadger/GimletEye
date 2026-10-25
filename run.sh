#!/usr/bin/env bash
# Build and launch the Mellivora ToolKit.
#
#   ./run.sh              native desktop window (builds it if needed)
#   ./run.sh --serve      workbench in a browser, served from this checkout
#   ./run.sh --dev        desktop window with hot reload
#   ./run.sh --build      force a rebuild first
#
# The default is the desktop app because that needs nothing but this checkout:
# the UI is compiled into the binary and the engine runs in-process.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"

mode="app"
port="${MELLIVORA_PORT:-7878}"
force=0
foreground=0

ui_dir="$root/packages/ui"
desktop_dir="$root/apps/desktop"
desktop_bin="$desktop_dir/src-tauri/target/release/mellivora-desktop"
cli_bin="$root/target/release/mellivora"
ui_index="$ui_dir/dist/index.html"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
fail() { printf '\033[31mrun: %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
    cat <<'USAGE'
Build and launch the Mellivora ToolKit.

  ./run.sh              native desktop window (builds it if needed)
  ./run.sh --serve      workbench in a browser, served from this checkout
  ./run.sh --dev        desktop window with hot reload
  ./run.sh --build      force a rebuild first

Options:
  --app         native desktop window (default)
  --serve       serve the workbench on loopback and print the URL
  --dev         desktop window against the Vite dev server (hot reload)
  --build       rebuild before launching, even when up to date
  -f, --foreground  keep the app attached to this terminal
  -p, --port N  port for --serve (default 7878, or MELLIVORA_PORT)
  -h, --help    this text

Environment: MELLIVORA_HOME, MELLIVORA_PLUGIN_PATH (see docs/PLUGIN_SDK.md).
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --app) mode="app" ;;
        --serve) mode="serve" ;;
        --dev) mode="dev" ;;
        --build) force=1 ;;
        -f | --foreground) foreground=1 ;;
        -p | --port)
            [ $# -ge 2 ] || fail "--port needs a number"
            port="$2"
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *) fail "unknown option '$1' (try --help)" ;;
    esac
    shift
done

have() { command -v "$1" >/dev/null 2>&1; }

newer_than() {
    # Any file under the given paths newer than the artifact?
    local artifact="$1"
    shift
    [ -f "$artifact" ] || return 0
    [ -n "$(find "$@" -type f -newer "$artifact" -print -quit 2>/dev/null)" ]
}

ui_stale() {
    newer_than "$ui_index" "$ui_dir/src" "$ui_dir/index.html" "$ui_dir/package.json"
}

desktop_stale() {
    newer_than "$desktop_bin" \
        "$root/crates" \
        "$desktop_dir/src-tauri/src" \
        "$desktop_dir/src-tauri/Cargo.toml" \
        "$desktop_dir/src-tauri/tauri.conf.json" \
        "$ui_dir/dist"
}

cli_stale() {
    newer_than "$cli_bin" "$root/crates" "$root/Cargo.toml" "$root/Cargo.lock"
}

install_ui_deps() {
    [ -d "$ui_dir/node_modules" ] && return 0
    have npm || fail "npm is required to build the UI (install Node 20+)"
    step "installing UI dependencies"
    (cd "$ui_dir" && npm ci --silent) || (cd "$ui_dir" && npm install --silent)
}

build_ui() {
    if [ "$force" -eq 1 ] || ui_stale; then
        install_ui_deps
        step "building the UI"
        (cd "$ui_dir" && npm run build)
    else
        info "UI is up to date"
    fi
}

build_desktop() {
    have cargo || fail "cargo is required (install Rust 1.85+)"
    build_ui
    if [ "$force" -eq 1 ] || desktop_stale; then
        step "building the desktop app"
        info "first build takes a few minutes; later ones are incremental"
        (cd "$desktop_dir/src-tauri" && cargo build --release --features custom-protocol)
    else
        info "desktop app is up to date"
    fi
}

build_cli() {
    have cargo || fail "cargo is required (install Rust 1.85+)"
    if [ "$force" -eq 1 ] || cli_stale; then
        step "building the CLI"
        cargo build --release -p mellivora-cli
    else
        info "CLI is up to date"
    fi
}

launch_app() {
    build_desktop
    if [ "$foreground" -eq 1 ]; then
        step "starting the desktop app"
        exec "$desktop_bin"
    fi

    # Detached on purpose: closing the terminal should not close the window.
    # The log keeps the shell's own diagnostics (engine address, window events).
    local log="${TMPDIR:-/tmp}/mellivora-desktop.log"
    if have setsid; then
        setsid "$desktop_bin" >"$log" 2>&1 &
    else
        "$desktop_bin" >"$log" 2>&1 &
    fi
    local pid=$!
    printf '\n\033[32mMellivora ToolKit is starting.\033[0m  Close the window to exit.\n'
    info "binary: $desktop_bin"
    info "pid:    $pid   (kill $pid to stop)"
    info "log:    $log"
}

launch_serve() {
    build_cli
    build_ui
    step "serving the workbench"
    info "UI    http://127.0.0.1:$port/"
    info "API   http://127.0.0.1:$port/api/v1/health"
    info "Ctrl+C stops it"
    exec "$cli_bin" serve --ui-dir "$ui_dir/dist" --port "$port"
}

launch_dev() {
    have npm || fail "npm is required for --dev (install Node 20+)"
    install_ui_deps
    [ -d "$desktop_dir/node_modules" ] || (cd "$desktop_dir" && npm install --silent)
    step "starting the desktop app with hot reload"
    info "UI changes reload in place; Ctrl+C stops the app and the dev server"
    exec npm --prefix "$desktop_dir" run dev
}

case "$mode" in
    app) launch_app ;;
    serve) launch_serve ;;
    dev) launch_dev ;;
esac
