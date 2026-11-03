# Gimlet Works

**One workbench for system administration, cryptography, and metadata privacy.**

A single tool registry, one report format, one configuration file, one audit
trail — behind a desktop app and a command line that share their implementation.

```bash
gimlet-works system-info                       # what is this host doing?
gimlet-works disk-usage --format json          # what is filling the disk?
gimlet-works passgen length=32                 # generate a secret
gimlet-works crypto.encrypt input=notes.txt passphrase_env=NOTES_PASS
gimlet-works keygen kind=x25519 label=alice keystore=true passphrase_env=KEY_PASS
gimlet-works crypto.encrypt input=notes.txt to=alice.pub   # for Alice, no shared secret
gimlet-works metadata-strip input=photo.jpg profile=sharing
gimlet-works metadata-strip input=photo.jpg profile=archive redact_gps=city
```

The same catalogue, the same reports, and the same audit trail are in the
desktop app — which needs no server, no port, and no account.

## What it does

| Pillar | Capability |
|---|---|
| **System** | Host inventory, filesystem utilisation with thresholds |
| **Crypto** | Authenticated file encryption (AES-256-GCM, ChaCha20-Poly1305 with Argon2id), encryption to X25519 recipients, a sealed keystore, Ed25519 signing and verification, OpenPGP interop through the system `gpg`, SHA-256, password generation with an entropy budget |
| **Privacy** | Metadata scan, strip, and verify for JPEG, PNG, and WebP; removal profiles; field-level keep/remove; GPS redaction that preserves the rest of EXIF |

Everything runs locally: nothing here opens a network connection, and there is no
telemetry, no auto-update, and no remote logging.

## Design

```
      desktop app ──┐                      ┌── command line
      (Electron, TS) │  packages/core:      │   (Node, TS)
                    ├─ catalogue · report ─┤
                    │  config · audit      │
                    └──────────┬───────────┘
                               │ in-process calls, no boundary
                    ┌──────────┴───────────┐
                    │    packages/engine   │
                    │  crypto + metadata   │
                    │      (TypeScript)    │
                    └──────────────────────┘
```

Three rules keep it maintainable:

1. **One implementation of the surface.** Tool resolution, report rendering,
   configuration, and the audit trail live once, in `packages/core`. The desktop
   app and the CLI are thin hosts around it, so a behaviour cannot differ between
   them.
2. **One implementation of the risky parts.** Cryptography and file-format
   parsing live in one engine package with the fuzz corpora, the golden fixtures,
   and a second implementation in Python that pins the container format. Both
   surfaces import it directly; there is no second process to keep in step, and
   no way for the two to disagree.
3. **Surfaces hold no logic.** They render a catalogue, run a tool, and draw a
   `Report`.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the
trade-offs behind it, and [ADR 0010](docs/adr/0010-retire-rust.md) for how the
last of the Rust left the tree.

## Interface

The desktop app (no cloud, no account, no uploads):

- **Start** wherever you left off: the window restores the tool you were using,
  its size and position. The three pillars — System, Crypto, Privacy — are
  buttons: each narrows the catalogue and opens its first tool.
- **Find** anything from the command palette (`Ctrl/⌘ K`): type a name, a tool id
  (`metadata-scan`), a tag, a capability (`fs:read`), or an action — "dark
  theme", "recent runs", "settings". Misspellings still land. Pinned tools and
  tools you last ran sit above the catalogue.
- **Fill in** generated forms: every field comes from the tool's manifest, so a
  new tool appears with its own inputs and no frontend change. A path argument
  gets the picker its manifest implies — file, folder, or either — and accepts a
  file dragged from the desktop.
- **Read** the report, which is its own view: findings grouped by severity, each
  offering the tool that answers it; the data as a sortable table; a diff against
  the previous run; the raw JSON. A metadata scan draws its segments in the file.
- **Check** what you did: strip and encrypt reports offer their verifier in one
  click, and every report keeps the equivalent `gimlet-works run …` command, copies as
  JSON or Markdown, and downloads.
- **Audit** what happened: recent runs from the local trail with their verdict,
  argument names only, never values. Settings → diagnostics names the version,
  the engine, and where the data lives.

The command line has the same catalogue: `gimlet-works tools list`.

## Install a release

Tagged releases carry prebuilt artifacts:

- `gimlet-works-<version>-<target>.tar.gz` / `.zip` — the CLI **and** the engine, for
  Linux (x86_64, aarch64), macOS (x86_64, aarch64), and Windows (x86_64)
- `.deb` and an Electron bundle (`.AppImage`, `.dmg`, NSIS `.exe`) — the desktop
  app, engine included; RPM and Arch recipes live in `packaging/` for building
  from source
- `SHA256SUMS` for all of the above

The archive carries the engine with the CLI: `packages/engine` is a workspace
dependency of `packages/core`, resolved from the tree, so there is no second
binary to place beside anything. An optional `GIMLET_WORKS_SIDECAR` can point at a
separate engine when you want to compare two implementations.

The CLI archives and source-built CLI packages need Node 20 or newer on the
system; desktop installers bundle their runtime. Current distributions ship
older: Debian 12 has 18, Ubuntu 22.04 has 12. Install a newer one from
[NodeSource](https://github.com/nodesource/distributions) (or Debian backports)
first, because the CLI distribution package declares `nodejs (>= 20)`.

The former `gimlet` command and `GIMLET_HOME`/`GIMLET_SIDECAR` variables remain
supported. Existing state and desktop preferences are reused in place; see the
[upgrade guide](docs/ADMIN_GUIDE.md#upgrading-and-rolling-back) for package and
platform-specific migration steps. Older releases retain their original names.

## Quick start

From a checkout:

```bash
./run.sh                 # build what is out of date, then open the desktop app
./run.sh --cli system-info   # the same tools on the command line
```

Or by hand:

```bash
npm install && npm run build
node packages/cli/bin/gimlet-works tools list
node packages/cli/bin/gimlet-works system-info
```

## Commands

```bash
gimlet-works tools list [--category sysadmin] [--format json]
gimlet-works tools show system-info
gimlet-works run <tool> [key=value ...] [--format text|json|markdown|csv|html] [--dry-run] [--strict]
gimlet-works <tool> [key=value ...]        # shorthand for `run`
gimlet-works batch <tool> <path>... [--arg key=value] [--input-arg NAME] [--ext EXT]
                [--concurrency 4] [--fail-fast] [--no-recursive]
gimlet-works config show|init|path
gimlet-works audit [--limit N]
gimlet-works doctor
gimlet-works tui                          # browse and run tools in the terminal
```

Exit codes: `0` ok or warning, `1` tool returned an error, `2` usage error.
`--strict` turns warnings into exit code `1`, so CI can gate on findings rather
than only on failures.

`batch` expands directories (recursively unless `--no-recursive`), runs the tool
once per file with the path bound to `--input-arg` (default `input`), and prints
one aggregate report with a per-file entry:

```bash
gimlet-works batch privacy.metadata-strip ~/Pictures --ext jpg --ext png --dry-run
gimlet-works batch privacy.metadata-scan ~/Pictures --format json --concurrency 8
```

A failing file names itself in the report and sets exit code `1`, but the rest of
the batch still runs unless `--fail-fast` is given.

## Status

| Area | Status |
|---|---|
| `Report` contract, registry, config, audit trail | ✅ |
| CLI: `run`, `batch`, `tools`, `config`, `audit`, `doctor`, `tui` | ✅ |
| Terminal surface (`gimlet-works tui`): filter, arguments, report, scroll | ✅ |
| Report as one self-contained page (`--format html`) | ✅ |
| Desktop app (Electron): palette, generated forms, report view, diagnostics, history | ✅ |
| `sysadmin.system-info`, `sysadmin.disk-usage`, `sysadmin.kernel-hardening`, `sysadmin.network` | ✅ TypeScript |
| `crypto.*`, `privacy.metadata-*` | ✅ TypeScript |
| Encryption container (chunked v2), AEAD, Argon2id, Ed25519 signatures | ✅ TypeScript |
| Sealed keystore (`crypto.key-*`), X25519 recipients in container v3 | ✅ TypeScript |
| GPS redaction to country, region, or city precision | ✅ TypeScript |
| OpenPGP interop (`crypto.gpg-verify`, `crypto.gpg-encrypt`) via system `gpg` | ✅ TypeScript |
| Secret sharing, shredding, QR | ⏳ roadmap |
| HEIC, AVIF, TIFF, PDF, MP4, RAW, GIF, SVG | ⏳ roadmap |
| WASM target, scheduler | ⏳ roadmap |

See [docs/ROADMAP.md](docs/ROADMAP.md) for acceptance criteria and
[docs/ENHANCEMENTS.md](docs/ENHANCEMENTS.md) for the prioritized backlog.

### What 1.0 freezes

Version 1.0 is a contract release: tool ids, the `Report` shape, the engine
protocol, the config schema, the `.gimlet` container, and the CLI's commands and
flags stop moving. Future changes to them follow a published deprecation policy
(one minor of an alias, then removal) and a support window of the two most recent
minors for at least twelve months — both in
[COMPATIBILITY.md](docs/COMPATIBILITY.md). The reasoning, the five gates behind
the freeze, and what each one needed are in
[ADR 0006](docs/adr/0006-what-1.0-promises.md).

## Layout

```
packages/
  core/       catalogue, report, args, config, audit, and the tools themselves
  engine/     the .gimlet container, keys, keystore, signing, and the metadata scrub
  cli/        `gimlet` — a Node CLI over packages/core
apps/desktop/ Electron shell (TS) + frontend; the main process owns the OS boundary
docs/         architecture, compatibility, roadmap, ADRs
scripts/      developer tooling
```

## Development

```bash
make check         # type-check, every test suite, and the documentation gates
make test          # the vitest suites
make build         # every package and the UI bundle
make desktop       # the desktop app for this platform
make smoke         # end-to-end: the CLI against real files
make doctor
```

Requirements: Node 20+, and `gpg` only if you use `crypto.gpg-*`.

## Documentation

- [User guide](docs/USER_GUIDE.md) — every command, with real output
- [Admin guide](docs/ADMIN_GUIDE.md) — installing, state files, backups
- [Architecture](docs/ARCHITECTURE.md) — layers, contracts, dependency rules
- [Container format](docs/CONTAINER.md) — byte layout of the `.gimlet` file
- [Compatibility](docs/COMPATIBILITY.md) — versioning, deprecation, removals
- [Roadmap](docs/ROADMAP.md) — phases and acceptance criteria
- [Enhancements](docs/ENHANCEMENTS.md) — proposed features with effort and risk
- [ADRs](docs/adr/) — decisions and their trade-offs
- [Provenance](docs/PROVENANCE.md) — maintainer notes on where modules began
- [Security](SECURITY.md) — threat model and data-handling guarantees

## License

MIT — see [LICENSE](LICENSE).

© 2026 Honey Badger Universe
