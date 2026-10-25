#!/usr/bin/env bash
# Fail when the declared rust-version is not the one CI actually compiles.
#
# `rust-version` is a promise; the MSRV job is the evidence. If the two are
# allowed to drift, the promise is untested - which is how this project came to
# claim 1.82 while its dependency graph already required 1.85.
#
# Usage: check-msrv.sh <tested-version>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tested="${1:?usage: check-msrv.sh <tested-version>}"

declared="$(sed -n 's/^rust-version = "\(.*\)"$/\1/p' "$root/Cargo.toml" | head -1)"

if [ -z "$declared" ]; then
    echo "no rust-version in [workspace.package] of Cargo.toml" >&2
    exit 1
fi

if [ "$declared" != "$tested" ]; then
    cat >&2 <<EOF
Cargo.toml declares rust-version = "$declared", but the msrv job tests "$tested".

Both have to move together:
  1. raise MSRV in Cargo.toml only after the dependency graph supports it
     (cargo +<version> check --workspace --all-targets --locked)
  2. set MSRV in .github/workflows/ci.yml to the same version
  3. update the requirements in README.md, CONTRIBUTING.md and run.sh, and the
     MSRV note in docs/ARCHITECTURE.md
EOF
    exit 1
fi

printf 'declared and tested MSRV agree: %s\n' "$declared"
