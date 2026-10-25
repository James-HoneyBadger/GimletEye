# Mellivora ToolKit

**One workbench for system administration, cryptography, and metadata privacy.**

A single tool registry, one report format, one configuration file, one audit
trail, and one interface — instead of a CLI, a GUI, and a configuration file per
task.

```bash
mellivora system-info                       # what is this host doing?
mellivora disk-usage --format json          # what is filling the disk?
mellivora passgen length=32                 # generate a secret
mellivora crypto.encrypt input=notes.txt passphrase_env=NOTES_PASS
mellivora metadata-strip input=photo.jpg profile=sharing
mellivora metadata-strip input=photo.jpg profile=archive redact_gps=city
mellivora serve --ui-dir packages/ui/dist   # same tools, in a browser or desktop window
```

## What it does

| Pillar | Capability |
|---|---|
| **System** | Host inventory, filesystem utilisation with thresholds, and — through packs — log, auth, permission, package, and service audits |
| **Crypto** | Authenticated file encryption (AES-256-GCM, ChaCha20-Poly1305 with Argon2id), Ed25519 signing and verification, SHA-256, password generation with an entropy budget |
| **Privacy** | Metadata scan, strip, and verify for JPEG, PNG, and WebP; removal profiles; field-level keep/remove; GPS redaction that preserves the rest of EXIF |

Everything runs locally: nothing here opens a network connection, and there is
no telemetry, no auto-update, and no remote logging. A pack declares the
`network` capability in its manifest, and the host refuses to dispatch any of
its tools unless that capability is granted — a tool cannot ask for more than
its manifest declared.

## Design

```
                    ┌────────────── surfaces ──────────────┐
   CLI (mellivora)  │  HTTP API  │  Tauri desktop  │  WASM   │
                    └─────────────┬────────────────────────┘
                                  │  Report / ToolManifest
                    ┌─────────────┴────────────────────────┐
                    │            mellivora-core            │
                    │  Tool · Report · Registry · Config   │
                    │  Audit · Capabilities · Plugin host  │
                    └─────────────┬────────────────────────┘
              ┌───────────────────┼───────────────────┐
        mellivora-sysadmin  mellivora-crypto   mellivora-scrub
              │                   │                   │
              └──────── packs (any language, JSON-RPC over stdio) ────────┘
```

Four rules keep it maintainable:

1. **One contract, many surfaces.** A capability is implemented once and exposed
   to the CLI, the HTTP API, the desktop shell, and the WASM target.
2. **Modules are additive.** Adding a domain is one line in the composition root
   — never a change to a handler or a view.
3. **Surfaces hold no logic.** They resolve a tool, run it, and render a
   `Report`.
4. **Anything can be a pack.** Existing code in another language participates
   through a documented protocol instead of waiting for a rewrite.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and the
trade-offs behind each decision.

## Interface

`mellivora serve` opens a local workbench — no cloud, no account, no uploads:

- **Browse** by category, or search across names, summaries, tags, capabilities,
  and argument names (`Ctrl/⌘ K`); arrow keys move through the list.
- **Fill in** generated forms: every field comes from the tool's manifest, so a
  new tool appears with its own inputs and no frontend change. Required fields
  are checked before anything is sent, and a half-filled form survives a tool
  switch.
- **Read** results as findings with severity, warnings, formatted report bodies,
  and structured data rendered as tables or key/value lists — with a JSON view,
  one-click copy, and a JSON download.
- **Run** with `Ctrl/⌘ ↵`; tools that write are marked `writes`, and only they
  offer **dry run**. Read-only tools say so instead.
- **Repeat** the run anywhere: every report carries the equivalent
  `mellivora run …` command, ready to copy.
- **Audit** what happened: the packs button lists every loaded pack with its
  tools and capabilities, and the clock button lists recent runs from the local
  audit trail (argument names only, never values).
- Dark and light themes follow the OS by default and are remembered, along with
  your last tool and filter.

The desktop app (`apps/desktop`) is the same bundle in a native window, with the
engine running inside the app: no server to start, no port to configure.

## Install a release

Tagged releases carry prebuilt binaries:

- `mellivora-<version>-<target>.tar.gz` / `.zip` — the CLI, with `README.md`,
  `LICENSE`, and `CHANGELOG.md`, for Linux (x86_64, aarch64), macOS (x86_64,
  aarch64), and Windows (x86_64)
- `.deb`, `.AppImage`, `.dmg`, and NSIS `.exe` — the desktop app, engine included
- `SHA256SUMS` for all of the above

```bash
tar -xzf mellivora-0.2.0-x86_64-unknown-linux-gnu.tar.gz
cd mellivora-0.2.0-x86_64-unknown-linux-gnu && ./mellivora doctor
```

## Quick start

One script builds whatever is out of date and opens the workbench:

```bash
./run.sh            # native desktop window
./run.sh --serve    # same tools in a browser at http://127.0.0.1:7878
./run.sh --dev      # desktop window with hot reload
./run.sh --help     # all options (--build, --port, --foreground)
```

Or work with the crates directly:

```bash
cargo test --workspace
cargo build --release

./target/release/mellivora tools list
./target/release/mellivora system-info
./target/release/mellivora run privacy.metadata-scan input=photo.jpg
```

Optional compatibility packs add capabilities from other implementations:

```bash
./scripts/link-sources.sh          # fetches sources the packs wrap
./target/release/mellivora plugins doctor
```

## Status

| Area | Status |
|---|---|
| `Report` contract, registry, config, audit trail | ✅ |
| Plugin protocol + host (JSON-RPC, timeouts, capabilities) | ✅ |
| CLI: `run`, `batch`, `tools`, `plugins`, `config`, `audit`, `doctor`, `serve` | ✅ |
| HTTP API (tools, run, packs, audit, config), shared UI, Tauri desktop shell | ✅ |
| `sysadmin.system-info`, `sysadmin.disk-usage` | ✅ native |
| `crypto.passgen`, `crypto.sha256` | ✅ native |
| `privacy.metadata-{scan,strip,verify}` for JPEG/PNG/WebP | ✅ native |
| Removal profiles, field-level control, GPS redaction | ✅ native |
| Encryption container (chunked v2), AEAD, Argon2id, Ed25519 signatures | ✅ native |
| Keystore, secret sharing, shredding, OpenPGP interop | ⏳ roadmap |
| HEIC, AVIF, TIFF, PDF, MP4, RAW, GIF, SVG | ⏳ packs, then native |
| WASM target, TUI, scheduler | ⏳ roadmap |

See [docs/ROADMAP.md](docs/ROADMAP.md) for acceptance criteria and
[docs/ENHANCEMENTS.md](docs/ENHANCEMENTS.md) for the prioritized backlog.

## Layout

```
crates/
  core/       contracts, registry, config, audit, plugin host   (no domain logic)
  sysadmin/   system and capacity tools
  crypto/     cryptographic tools + CryptoBackend engine seam
  scrub/      metadata inspection, redaction, removal
  server/     HTTP API
  toolkit/    composition root: modules wired into a runtime, serve helpers
  cli/        `mellivora` binary
packages/ui/  one TypeScript UI for browser and desktop
apps/desktop/ Tauri 2 shell with the engine embedded
plugins/      compatibility packs (optional)
docs/         architecture, plugin SDK, compatibility, roadmap, ADRs
scripts/      developer tooling
```

## Commands

```bash
mellivora tools list [--category sysadmin] [--format json]
mellivora tools show disk-usage
mellivora run <tool> [key=value ...] [--format text|json|markdown|csv] [--dry-run] [--strict]
mellivora <tool> [key=value ...]        # shorthand for `run`
mellivora batch <tool> <path>... [--arg key=value] [--input-arg NAME] [--ext EXT]
                [--concurrency 4] [--fail-fast] [--no-recursive]
mellivora plugins list|doctor
mellivora config show|init|path
mellivora audit [--limit N]
mellivora doctor
mellivora serve [--host 127.0.0.1] [--port 7878] [--ui-dir DIR] [--allow-remote]
```

Exit codes: `0` ok or warning, `1` tool returned an error, `2` usage error.
`--strict` turns warnings into exit code `1`, so CI can gate on findings rather
than only on failures.

`serve` generates an API token on first run — owner-only at
`$MELLIVORA_HOME/api-token` — prints it, and answers `401` to any `/api/` request
that does not carry it. The URL it prints carries the token in its fragment, so
the workbench signs itself in; for `curl`, send the header:

```bash
curl -X POST http://127.0.0.1:7878/api/v1/run \
     -H "Authorization: Bearer $(cat "$MELLIVORA_HOME/api-token")" \
     -d '{"tool":"sha256","args":{"text":"abc"}}'
```

Set `[api] require_token = false` only for a scratch instance you are willing to
have any local page drive; `serve` warns when you do.

`batch` expands directories (recursively unless `--no-recursive`), runs the tool
once per file with the path bound to `--input-arg` (default `input`), and prints
one aggregate report with a per-file entry:

```bash
mellivora batch privacy.metadata-strip ~/Pictures --ext jpg --ext png --dry-run
mellivora batch privacy.metadata-scan ~/Pictures --format json --concurrency 8
```

A failing file names itself in the report and sets exit code `1`, but the rest of
the batch still runs unless `--fail-fast` is given.

Symlinks are followed: a linked directory is walked, each directory is visited
once by its real path, and a link cycle terminates instead of looping.

Desktop app — one command, engine included:

```bash
./run.sh                                          # builds and opens the window
cd apps/desktop && npm run build                  # bundles for this platform
npm run build -- --no-bundle                      # or just the standalone binary
npm run dev                                       # or run it hot-reloading
```

The release binary (`src-tauri/target/release/mellivora-desktop`) is
self-contained: UI embedded, engine in-process, no server and no port to
configure.

## Development

```bash
make check         # fmt, clippy, tests — everything CI runs
make msrv          # build every target on the declared MSRV (1.85)
make quiet-period  # verify no frozen surface moved since the last release
make test          # cargo test --workspace
make ui            # type-check + build the shared UI
make ui-test       # UI unit and DOM tests (vitest)
make smoke         # end-to-end: CLI, API, packs
make doctor
```

Requirements: Rust 1.85+, Node 20+ (UI only), and Perl 5.28+ only if you install
the Perl compatibility pack.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — layers, contracts, dependency rules
- [Plugin SDK](docs/PLUGIN_SDK.md) — write a pack in any language
- [Container format](docs/CONTAINER.md) — byte layout of the `.melv` file
- [Compatibility](docs/COMPATIBILITY.md) — versioning, deprecation, rollback
- [Roadmap](docs/ROADMAP.md) — phases and acceptance criteria
- [Enhancements](docs/ENHANCEMENTS.md) — proposed features with effort and risk
- [ADRs](docs/adr/) — decisions and their trade-offs
- [Provenance](docs/PROVENANCE.md) — maintainer notes on where modules began
- [Security](SECURITY.md) — threat model and data-handling guarantees

## License

MIT — see [LICENSE](LICENSE).

© 2026 Honey Badger Universe
