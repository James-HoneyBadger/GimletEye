# Administrator guide

For the person who installs this on a machine someone else will use: where state
lives, what the configuration controls, and what the audit trail records.

- [Installation](#installation)
- [State on disk](#state-on-disk)
- [Configuration](#configuration)
- [The audit trail](#the-audit-trail)
- [Upgrading and rolling back](#upgrading-and-rolling-back)
- [Verifying a release](#verifying-a-release)

## Installation

Pick one, in order of preference for a managed machine:

```bash
# a distribution package, when one is available for your release
dpkg -i gimlet_*.deb
rpm -i gimlet-eye-toolkit-*.rpm
makepkg -si            # packaging/arch/PKGBUILD

# the release archive: the CLI and the engine it spawns
tar -xzf gimlet-<version>-<target>.tar.gz -C /usr/local
```

Two programs matter: `gimlet` (the command line) and `gimlet-sidecar` (the
engine). Keep them in the same directory — the CLI looks for the engine beside
itself — or set `GIMLET_SIDECAR` to its path. The desktop app carries its own
copy of the engine, so installing both packages is safe.

The CLI needs Node 20+. `gpg` is optional and only needed by `crypto.gpg-*`.

## State on disk

Everything lives under one root, `$GIMLET_HOME`, which defaults to
`~/.config/gimlet`:

| Path | Mode | What it is | Back it up |
|---|---|---|---|
| `config.toml` | 0644 | configuration; safe to commit to a config-management repo | yes |
| `keystore.gimlet` | **0600** | sealed keys; unreadable without the passphrase | **yes** |
| `audit.jsonl` | 0644 | one JSON line per tool run, argument *names* only | yes |
| `cache/`, `data/` | 0755 | working space | no |

Backing up `keystore.gimlet` without its passphrase is worthless, and backing up
the passphrase next to it defeats the seal. Keep them apart.

## Configuration

One TOML file, namespaced by module:

```toml
schema_version = 1

[defaults]
output = "json"        # a per-run --format still wins

[audit]
enabled = true
max_entries = 10000

[modules.sysadmin]
disk_warn_percent = 85
```

`gimlet config show` prints the effective configuration after defaults are
applied; `gimlet config path` prints which file was read. A config written by
a newer release is refused rather than reinterpreted.

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

`gimlet audit --limit 20` reads it back; `--format json` for a collector.

## Upgrading and rolling back

The upgrade path is a package operation, and the files that matter are the ones
in `$GIMLET_HOME`. Neither the keystore nor the audit trail is tied to a
version:

```bash
dpkg -i gimlet_<new>.deb     # or your package manager
gimlet --version
gimlet doctor
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
