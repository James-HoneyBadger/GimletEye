#!/usr/bin/env bash
# Fetch optional external sources used by compatibility packs.
#
# Nothing here is required by the toolkit itself. This script only fetches what
# a given pack needs, into external/ (gitignored), so the pack can read it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
external="$root/external"
mkdir -p "$external"

clone_if_missing() {
    local name="$1" url="$2"
    local dest="$external/$name"
    if [ -d "$dest/lib" ] || [ -d "$dest/.git" ]; then
        printf '  = %-14s already present\n' "$name"
        return
    fi
    printf '  + %-14s cloning (shallow)\n' "$name"
    git clone --depth 1 --quiet "$url" "$dest"
}

echo "linking pack sources into $external"
# Required by the Perl Den compatibility pack; small.
clone_if_missing Perl_Den https://github.com/James-HoneyBadger/Perl_Den.git

if [ "${1:-}" = "--all" ]; then
    # Reference only: useful when writing a new adapter or comparing
    # behaviour. Expect a large download.
    clone_if_missing Zayfer_Vault https://github.com/James-HoneyBadger/Zayfer_Vault.git
    clone_if_missing NakiByte https://github.com/James-HoneyBadger/NakiByte.git
else
    echo "  (pass --all for the other reference checkouts; only needed for porting)"
fi

echo
echo "verify with:"
echo "  cargo run -p mellivora-cli -- plugins doctor"
