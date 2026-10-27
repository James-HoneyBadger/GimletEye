# Gimlet Eye

**One workbench for system administration, cryptography, and metadata privacy.**

A single tool registry, one report format, one configuration file, one audit
trail — behind a desktop app and a command line that share their implementation.

```bash
gimlet system-info                       # what is this host doing?
gimlet disk-usage --format json          # what is filling the disk?
gimlet passgen length=32                 # generate a secret
gimlet crypto.encrypt input=notes.txt passphrase_env=NOTES_PASS
gimlet keygen kind=x25519 label=alice keystore=true passphrase_env=KEY_PASS
gimlet crypto.encrypt input=notes.txt to=alice.pub   # for Alice, no shared secret
gimlet metadata-strip input=photo.jpg profile=sharing
gimlet metadata-strip input=photo.jpg profile=archive redact_gps=city
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
      (Tauri, TS)   │  packages/core:      │   (Node, TS)
                    ├─ catalogue · report ─┤
                    │  config · audit      │
                    └──────────┬───────────┘
                               │ one line of JSON per request
                    ┌──────────┴───────────┐
                    │    gimlet-sidecar    │
                    │  crypto + metadata   │
                    │  (Rust, fuzz-tested) │
                    └──────────────────────┘
```

Three rules keep it maintainable:

1. **One implementation of the surface.** Tool resolution, report rendering,
   configuration, and the audit trail live once, in `packages/core`. The desktop
   app and the CLI are thin hosts around it, so a behaviour cannot differ between
   them.
2. **One implementation of the risky parts.** Cryptography and file-format
   parsing live in one Rust engine with the fuzz corpora, the golden fixtures, and
   a second implementation in Python that pins the container format. It is spawned
   by both surfaces and speaks a versioned protocol — it is not an extension
   point.
3. **Surfaces hold no logic.** They render a catalogue, run a tool, and draw a
   `Report`.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the
trade-offs behind it, and [ADR 0008](docs/adr/0008-typescript-surfaces-rust-engine.md)
for why the surfaces moved out of Rust.

## Interface

The desktop app (no cloud, no account, no uploads):

- **Start** from the three pillars — System, Crypto, Privacy — which are buttons:
  each narrows the catalogue and opens its first tool. Your last tool is restored
  next time.
- **Browse** by category, or search across names, summaries, tags, capabilities,
  and argument names (`Ctrl/⌘ K`).
- **Fill in** generated forms: every field comes from the tool's manifest, so a
  new tool appears with its own inputs and no frontend change.
- **Read** results as findings with severity, warnings, and structured data —
  with a JSON view, one-click copy, and a JSON download.
- **Repeat** the run anywhere: every report carries the equivalent
  `gimlet run …` command.
- **Audit** what happened: recent runs from the local trail, with argument names
  only, never values.

The command line has the same catalogue: `gimlet tools list`.

## Install a release

Tagged releases carry prebuilt artifacts:

- `gimlet-<version>-<target>.tar.gz` / `.zip` — the CLI **and** the engine, for
  Linux (x86_64, aarch64), macOS (x86_64, aarch64), and Windows (x86_64)
- `.deb`, `.rpm`, and a Tauri bundle (`.AppImage`, `.dmg`, NSIS `.exe`) — the
  desktop app, engine included
- `SHA256SUMS` for all of the above

The CLI finds the engine next to itself. If you place it somewhere else, set
`GIMLET_SIDECAR` to its path.

## Quick start

From a checkout:

```bash
./run.sh                 # build what is out of date, then open the desktop app
./run.sh --cli system-info   # the same tools on the command line
```

Or by hand:

```bash
cargo build --release -p gimlet-eye-sidecar
npm install && npm run build
node packages/cli/bin/gimlet tools list
node packages/cli/bin/gimlet system-info
```

## Commands

```bash
gimlet tools list [--category sysadmin] [--format json]
gimlet tools show system-info
gimlet run <tool> [key=value ...] [--format text|json|markdown|csv|html] [--dry-run] [--strict]
gimlet <tool> [key=value ...]        # shorthand for `run`
gimlet batch <tool> <path>... [--arg key=value] [--input-arg NAME] [--ext EXT]
                [--concurrency 4] [--fail-fast] [--no-recursive]
gimlet config show|init|path
gimlet audit [--limit N]
gimlet doctor
gimlet tui                          # browse and run tools in the terminal
```

Exit codes: `0` ok or warning, `1` tool returned an error, `2` usage error.
`--strict` turns warnings into exit code `1`, so CI can gate on findings rather
than only on failures.

`batch` expands directories (recursively unless `--no-recursive`), runs the tool
once per file with the path bound to `--input-arg` (default `input`), and prints
one aggregate report with a per-file entry:

```bash
gimlet batch privacy.metadata-strip ~/Pictures --ext jpg --ext png --dry-run
gimlet batch privacy.metadata-scan ~/Pictures --format json --concurrency 8
```

A failing file names itself in the report and sets exit code `1`, but the rest of
the batch still runs unless `--fail-fast` is given.

## Status

| Area | Status |
|---|---|
| `Report` contract, registry, config, audit trail | ✅ |
| CLI: `run`, `batch`, `tools`, `config`, `audit`, `doctor`, `tui` | ✅ |
| Terminal surface (`gimlet tui`): filter, arguments, report, scroll | ✅ |
| Report as one self-contained page (`--format html`) | ✅ |
| Desktop app (Tauri): catalogue, generated forms, reports, history | ✅ |
| `sysadmin.system-info`, `sysadmin.disk-usage`, `sysadmin.kernel-hardening`, `sysadmin.network` | ✅ TypeScript |
| `crypto.*`, `privacy.metadata-*` | ✅ Rust engine |
| Encryption container (chunked v2), AEAD, Argon2id, Ed25519 signatures | ✅ Rust engine |
| Sealed keystore (`crypto.key-*`), X25519 recipients in container v3 | ✅ Rust engine |
| OpenPGP interop (`crypto.gpg-verify`, `crypto.gpg-encrypt`) via system `gpg` | ✅ Rust engine |
| Secret sharing, shredding, QR | ⏳ roadmap |
| HEIC, AVIF, TIFF, PDF, MP4, RAW, GIF, SVG | ⏳ roadmap |
| WASM target, scheduler | ⏳ roadmap |

See [docs/ROADMAP.md](docs/ROADMAP.md) for acceptance criteria and
[docs/ENHANCEMENTS.md](docs/ENHANCEMENTS.md) for the prioritized backlog.

## Layout

```
packages/
  core/       catalogue, report contract, args, config, audit, sidecar client (TS)
  engine/     the .gimlet container in TypeScript — ADR 0010 stage 1
  cli/        `gimlet` — a Node CLI over packages/core
apps/desktop/ Tauri 2 window + frontend; the Rust shell is window and OS boundary only
crates/
  core/       contracts the engine needs: report, manifest, args, config, paths
  crypto/     cryptographic tools + the CryptoBackend seam
  scrub/      metadata inspection, redaction, removal
  sidecar/    `gimlet-sidecar`: the engine both surfaces spawn
docs/         architecture, compatibility, roadmap, ADRs
scripts/      developer tooling
```

## Development

```bash
make check         # fmt, clippy, type-check, and every test suite
make test          # engine (cargo) and TypeScript (vitest) suites
make build         # engine, CLI, and the UI bundle
make desktop       # the desktop app for this platform
make smoke         # end-to-end: CLI against the real engine
make doctor
```

Requirements: Rust 1.85+ (engine), Node 20+ (CLI and desktop), and `gpg` only if
you use `crypto.gpg-*`.

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
