#!/usr/bin/env bash
# Build and launch Gimlet Eye.
#
#   ./run.sh              the desktop app (builds it if needed)
#   ./run.sh --cli ...    the command line, e.g. ./run.sh --cli system-info
#   ./run.sh --build      force a rebuild first
#
# The desktop app needs the UI bundle and the built packages; both are built here,
# so a checkout is enough to run it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"

mode="app"
force=0
cli_args=()

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
fail() { printf '\033[31mrun: %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
    cat <<'USAGE'
Build and launch Gimlet Eye.

  ./run.sh                 the desktop app (default)
  ./run.sh --cli <args>    run the command line instead
  ./run.sh --build         rebuild before launching

Environment: GIMLET_HOME (see docs/USER_GUIDE.md).
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --app) mode="app" ;;
        --cli) mode="cli"; shift; cli_args=("$@"); break ;;
        --build) force=1 ;;
        -h | --help) usage; exit 0 ;;
        *) fail "unknown option '$1' (try --help)" ;;
    esac
    shift
done

have() { command -v "$1" >/dev/null 2>&1; }

newer_than() {
    local artifact="$1"
    shift
    [ -f "$artifact" ] || return 0
    [ -n "$(find "$@" -type f -newer "$artifact" -print -quit 2>/dev/null)" ]
}

cli_bin="packages/cli/dist/main.js"
ui_bundle="apps/desktop/dist/index.html"

cli_stale() { newer_than "$cli_bin" packages/core/src packages/engine/src packages/cli/src; }
ui_stale() { newer_than "$ui_bundle" apps/desktop/src apps/desktop/index.html; }

install_node_deps() {
    [ -d node_modules ] && return 0
    have npm || fail "npm is required (install Node 20+)"
    step "installing dependencies"
    npm ci --silent 2>/dev/null || npm install --silent
}

build_cli() {
    install_node_deps
    if [ "$force" -eq 1 ] || cli_stale; then
        step "building the CLI"
        npm run build --silent
    else
        info "CLI is up to date"
    fi
}

build_ui() {
    install_node_deps
    if [ "$force" -eq 1 ] || ui_stale; then
        step "building the UI bundle"
        npm run build:ui -w @gimlet-eye/desktop --silent
    else
        info "UI is up to date"
    fi
}

case "$mode" in
    cli)
        build_cli
        exec node "$cli_bin" "${cli_args[@]}"
        ;;
    app)
        build_ui
        install_node_deps
        build_cli
        step "starting the desktop app"
        info "first build takes a few minutes; later ones are incremental"
        cd apps/desktop
        exec npm run electron:start
        ;;
esac
