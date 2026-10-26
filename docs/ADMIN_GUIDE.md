# Administrator guide

For the person who installs this on a machine someone else will use: where state
lives, what the API is allowed to do, how packs are trusted, and what the audit
trail records.

- [Installation](#installation)
- [State on disk](#state-on-disk)
- [Configuration](#configuration)
- [The local API](#the-local-api)
- [Packs](#packs)
- [The audit trail](#the-audit-trail)
- [Upgrading and rolling back](#upgrading-and-rolling-back)
- [Verifying a release](#verifying-a-release)

## Installation

Pick one, in order of preference for a managed machine:

```bash
# a distribution package, when one is available for your release
dpkg -i mellivora_*.deb
rpm -i mellivora-toolkit-*.rpm
makepkg -si            # packaging/arch/PKGBUILD

# the release archive
tar -xzf mellivora-<version>-<target>.tar.gz -C /usr/local

# or from source, pinned to the tag
cargo install --locked --git https://github.com/James-HoneyBadger/Mellivora_ToolKit --tag v<version> mellivora-cli
```

The binary is self-contained apart from libc. `perl` is optional and only needed
by the compatibility pack; `gpg` is optional and only needed by `crypto.gpg-*`.

## State on disk

Everything lives under one root, `$MELLIVORA_HOME`, which defaults to
`~/.config/mellivora`:

| Path | Mode | What it is | Back it up |
|---|---|---|---|
| `config.toml` | 0644 | configuration; safe to commit to a config-management repo | yes |
| `keystore.melv` | **0600** | sealed keys; unreadable without the passphrase | **yes** |
| `audit.jsonl` | 0644 | one JSON line per tool run, argument *names* only | yes |
| `api-token` | **0600** | credential for `/api/v1`, created on first `serve` | no; regenerates |
| `cache/`, `data/` | 0755 | working space | no |

Backing up `keystore.melv` without its passphrase is worthless, and backing up
the passphrase next to it defeats the seal. Keep them apart.

## Configuration

One TOML file, namespaced by module:

```toml
schema_version = 1

[defaults]
output = "json"        # a per-run --format still wins

[plugins]
dirs = []              # extra pack directories
disabled = ["noisy-pack"]
timeout_ms = 30000
allow = ["fs:read", "system"]   # empty = grant whatever a pack declares

[audit]
enabled = true
max_entries = 10000

[api]
require_token = true

[trust]
"perlden" = "sha256:…"  # pin a pack you did not write

[modules.sysadmin]
disk_warn_percent = 85
```

`mellivora config show` prints the effective configuration after defaults are
applied; `mellivora config path` prints which file was read. A config written by
a newer release is refused rather than reinterpreted.

## The local API

`mellivora serve` binds loopback and requires a token:

- `POST /api/v1/run` — the only endpoint that does anything
- `GET /api/v1/health | tools | packs | audit | config`
- CORS grants the desktop window, the Vite dev server, and loopback origins only
- a non-loopback bind is refused unless `--allow-remote` is passed explicitly

The token is printed once and stored at `api-token` (0600). To rotate it, delete
the file and restart; every client that cached it gets `401` until it is updated.
`[api] require_token = false` is the escape hatch for a single-user machine and
prints a warning at startup, because it means any page the user visits can drive
the tools.

Treat the API as a local control plane, not a service: there are no accounts, no
per-caller permissions, and no TLS.

## Packs

A pack is an executable that speaks JSON-RPC on stdin/stdout, which means a pack
is arbitrary code. Discovery trusts what is on disk; pinning is how you stop
trusting it blindly.

```bash
mellivora plugins list                       # what loaded, what failed
mellivora plugins doctor                     # start each pack, list its tools
mellivora plugins conformance ~/packs/foo    # the SDK checklist, mechanically
mellivora plugins pin ~/packs/foo            # the digest to paste into [trust]
```

Grant the narrowest capability set that works. `allow = ["fs:read"]` means no
pack may write, exec, or reach the network, whatever its manifest asks for. A
tool may ask for a subset of its pack's capabilities and never more; a pack that
tries is refused at load.

## The audit trail

One line per run, append-only:

```json
{"ts":"2026-10-25T18:04:11Z","tool":"crypto.encrypt","status":"ok","duration_ms":312,"arg_keys":["input","passphrase_env"]}
```

A run that fails gets a line too, with `"status":"error"` and the same
argument-name-only detail. That is deliberate: an attempt to guess a passphrase is
a series of failures, and a trail that only stored successes would show nothing at
all. The duration is the time until the failure.

Argument *values* are never recorded — only their names — so a passphrase cannot
leak into the trail. Pruning is atomic and serialised: `max_entries` trims through
a temporary file and a rename, so a concurrent writer cannot lose a record and a
reader cannot see a half-written line.

`mellivora audit --limit 20` reads it back; `--format json` for a collector.

## Upgrading and rolling back

The upgrade path is a package operation, and the files that matter are the ones
in `$MELLIVORA_HOME`. Neither the keystore nor the audit trail is tied to a
version:

```bash
dpkg -i mellivora_<new>.deb     # or your package manager
mellivora --version
mellivora doctor
```

Rolling back is installing the previous package. Keys created by a newer release
stay readable by it, and the audit trail only ever grows. `scripts/rehearse-upgrade.sh`
is that whole sequence run in a container, asserted end to end — install, create
a keystore, upgrade, roll back, upgrade again — so the claim is tested rather
than asserted.

## Verifying a release

```bash
./scripts/verify-release.sh SHA256SUMS SHA256SUMS.minisig
```

It checks the signature against the release key published in
[SECURITY.md](../SECURITY.md), then every file against the checksums, and refuses
to report success if either step is missing. Release builds are reproducible: the
same tag produces the same bytes, and CI rebuilds it twice and compares before
anything is published.
