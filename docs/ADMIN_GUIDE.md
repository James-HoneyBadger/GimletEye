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
# a source-built distribution package, when one is available for your release
sudo apt install ./gimlet-works_*.deb
sudo dnf install ./gimlet-works-toolkit-*.rpm
makepkg -si            # packaging/arch/PKGBUILD

# the release archive: the CLI plus the core and engine packages
tar -xzf gimlet-works-<version>-<target>.tar.gz
./gimlet-works-<version>-<target>/packages/cli/bin/gimlet-works --version
```

One program matters: `gimlet-works` (the command line). The old `gimlet` command
is also installed as an alias. It carries every tool, so there
is no second binary to keep beside it and nothing to install into a particular
directory. The desktop app runs the same packages in its own process, so
installing both is safe.

The CLI needs Node 20+. `gpg` is optional and only needed by `crypto.gpg-*`.

## State on disk

Everything lives under one root. For a fresh install this defaults to
`~/.config/gimlet-works` on Linux (or `$XDG_CONFIG_HOME/gimlet-works` when set),
`~/Library/Application Support/gimlet-works` on macOS, and
`%APPDATA%\gimlet-works` on Windows. Set `GIMLET_WORKS_HOME` to override it.

| Path | Mode | What it is | Back it up |
|---|---|---|---|
| `config.toml` | 0644 | configuration; safe to commit to a config-management repo | yes |
| `keystore.gimlet` | **0600** | sealed keys; unreadable without the passphrase | **yes** |
| `audit.jsonl` | 0644 | one JSON line per tool execution, argument *names* only | yes |
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

`gimlet-works config show` prints the effective configuration after defaults are
applied; `gimlet-works config path` prints which file was read. A config written by
a newer release is refused rather than reinterpreted.

`max_entries` limits logical runs, not physical JSONL rows. A batch has one
`run_id` shared by its per-file records, and the whole batch is retained or
pruned together. Existing entries without a run id count as individual runs.

## The audit trail

One line per tool execution:

```json
{"ts":"2026-10-25T18:04:11Z","tool":"crypto.encrypt","status":"ok","duration_ms":312,"arg_keys":["input","passphrase_env"],"run_id":"m8e...","dry_run":false}
```

A run that fails gets a line too, with `"status":"error"` and the same
argument-name-only detail. That is deliberate: an attempt to guess a passphrase is
a series of failures, and a trail that only stored successes would show nothing at
all. The duration is the time until the failure.

Argument *values* are never recorded — only their names — so a passphrase cannot
leak into the trail. Batch rows carry `run_index` and `run_count` without
recording file paths. Pruning writes a temporary file and renames it atomically;
concurrent processes can still race while trimming, so keep a backup if the
trail is being used as long-term evidence.

`gimlet-works audit --limit 20` reads it back; `--format json` for a collector.

## Upgrading and rolling back

Before upgrading, back up the state root and keystore passphrase separately and
close the old app. A non-empty `--home` takes precedence over
`GIMLET_WORKS_HOME`, then the legacy `GIMLET_HOME`. Without an override, an
existing `gimlet-works` root wins; otherwise the existing `gimlet` root, then
`mellivora`, are reused in place. Nothing is moved or deleted. The `.gimlet`
containers, keystore and audit files keep their formats.

```bash
# For a source-built Debian CLI upgrade, install the main and transitional packages:
sudo apt install ./gimlet-works_<new>_<arch>.deb ./gimlet_<new>_all.deb
gimlet-works --version
gimlet-works doctor
```

The Debian `gimlet` package is a transitional dependency on `gimlet-works`;
the Arch and RPM recipes declare the old toolkit package as replaced. The
desktop `.deb` replaces `gimlet-eye`. AppImages are standalone, and on macOS
the new `Gimlet Works.app` is a separate application: after checking it, remove
the old app manually if desired. The Windows NSIS installer retains the old
upgrade identity; check the installation before removing any old shortcut.

The Electron profile is separate from the toolkit state root. An existing
`@gimlet-eye/desktop` profile (or `Gimlet Eye` profile) is reused if the new
profile has no saved app state, preserving window settings and preferences.
An explicit `--user-data-dir` is respected.

For a Debian CLI rollback, remove the transitional and new packages before
installing the old `gimlet` package; package removal does not remove per-user
state. The old CLI cannot discover a newly created `gimlet-works` root by
itself, so set `GIMLET_HOME` to that root when rolling back a fresh installation.
`scripts/rehearse-upgrade.sh` builds the actual old release and the current
package and exercises the upgrade, rollback and second upgrade in a container.

## Verifying a release

```bash
./scripts/verify-release.sh SHA256SUMS SHA256SUMS.minisig
```

It checks the signature against the release key published in
[SECURITY.md](../SECURITY.md), then every file against the checksums, and refuses
to report success if either step is missing. Release builds are reproducible: the
same tag produces the same bytes, and CI rebuilds it twice and compares before
anything is published.
