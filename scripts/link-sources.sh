#!/usr/bin/env bash
# Link the source projects into external/ for local development.
#
# The toolkit references these repositories rather than vendoring them, so this
# script only fetches what a given workflow needs.
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

echo "linking sources into $external"
# Perl Den is required by the perlden-pack adapter and is small.
clone_if_missing Perl_Den https://github.com/James-HoneyBadger/Perl_Den.git

if [ "${1:-}" = "--all" ]; then
    # Reference only: these stay in their own repositories until their ports
    # land. Expect a large download.
    clone_if_missing Zayfer_Vault https://github.com/James-HoneyBadger/Zayfer_Vault.git
    clone_if_missing NakiByte https://github.com/James-HoneyBadger/NakiByte.git
else
    echo "  (pass --all for Zayfer_Vault and NakiByte; only needed for porting)"
fi

echo
echo "verify with:"
echo "  cargo run -p mellivora-cli -- plugins doctor"
