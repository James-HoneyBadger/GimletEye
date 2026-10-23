# Mellivora ToolKit

**One workbench for system administration, cryptography, and metadata privacy.**

A single tool registry, one report format, one configuration file, one audit
trail, and one interface — instead of a CLI, a GUI, and a configuration file per
task.

```bash
mellivora system-info                       # what is this host doing?
mellivora disk-usage --format json          # what is filling the disk?
mellivora passgen length=32                 # generate a secret
mellivora metadata-strip input=photo.jpg profile=sharing
mellivora metadata-strip input=photo.jpg profile=archive redact_gps=city
mellivora serve --ui-dir packages/ui/dist   # same tools, in a browser or desktop window
```

## What it does

| Pillar | Capability |
|---|---|
| **System** | Host inventory, filesystem utilisation with thresholds, and — through packs — log, auth, permission, package, and service audits |
| **Crypto** | OS-backed randomness, SHA-256, password generation with an entropy budget; authenticated encryption, signatures, and key management land behind one engine trait |
| **Privacy** | Metadata scan, strip, and verify for JPEG, PNG, and WebP; removal profiles; field-level keep/remove; GPS redaction that preserves the rest of EXIF |

Everything runs locally. There is no telemetry, no auto-update, and no network
access unless a tool declares the `network` capability and you grant it.

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

## Quick start

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
| CLI: `run`, `tools`, `plugins`, `config`, `audit`, `doctor`, `serve` | ✅ |
| HTTP API, shared UI, Tauri desktop shell | ✅ |
| `sysadmin.system-info`, `sysadmin.disk-usage` | ✅ native |
| `crypto.passgen`, `crypto.sha256` | ✅ native |
| `privacy.metadata-{scan,strip,verify}` for JPEG/PNG/WebP | ✅ native |
| Removal profiles, field-level control, GPS redaction | ✅ native |
| Native crypto engine (AEAD, signatures, container, keystore) | ⏳ `CryptoBackend` seam defined |
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
  cli/        `mellivora` binary (composition root)
packages/ui/  one TypeScript UI for browser and desktop
apps/desktop/ Tauri 2 desktop shell
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
mellivora plugins list|doctor
mellivora config show|init|path
mellivora audit [--limit N]
mellivora doctor
mellivora serve [--host 127.0.0.1] [--port 7878] [--ui-dir DIR]
```

Exit codes: `0` ok or warning, `1` tool returned an error, `2` usage error.
`--strict` turns warnings into exit code `1`, so CI can gate on findings rather
than only on failures.

Desktop shell:

```bash
cargo run -p mellivora-cli -- serve           # terminal 1
cd apps/desktop && npm install && npm run dev # terminal 2
```

## Development

```bash
make check      # fmt, clippy, tests — everything CI runs
make test       # cargo test --workspace
make ui         # type-check + build the shared UI
make smoke      # end-to-end: CLI, API, packs
make doctor
```

Requirements: Rust 1.82+, Node 20+ (UI only), and Perl 5.28+ only if you install
the Perl compatibility pack.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — layers, contracts, dependency rules
- [Plugin SDK](docs/PLUGIN_SDK.md) — write a pack in any language
- [Compatibility](docs/COMPATIBILITY.md) — versioning, deprecation, rollback
- [Roadmap](docs/ROADMAP.md) — phases and acceptance criteria
- [Enhancements](docs/ENHANCEMENTS.md) — proposed features with effort and risk
- [ADRs](docs/adr/) — decisions and their trade-offs
- [Provenance](docs/PROVENANCE.md) — maintainer notes on where modules began
- [Security](SECURITY.md) — threat model and data-handling guarantees

## License

MIT — see [LICENSE](LICENSE).

© 2026 Honey Badger Universe
