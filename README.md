# Mellivora ToolKit

One workbench for **system administration**, **cryptography**, and **metadata
privacy** — built from three existing projects behind a single contract.

| Source project | What it contributes | In the toolkit |
|---|---|---|
| [Perl_Den](https://github.com/James-HoneyBadger/Perl_Den) | 20 sysadmin modules, Perl IDE | `mellivora-sysadmin` + `perlden` pack (live today) |
| [Zayfer_Vault / DarkStar](https://github.com/James-HoneyBadger/Zayfer_Vault) | AES-GCM, ChaCha20, Ed25519, X25519, RSA, Argon2id, OpenPGP, HBZF container, keystore, audit | `mellivora-crypto` (seam) → native engine |
| [NakiByte / HB_Scrub](https://github.com/James-HoneyBadger/NakiByte) | Byte-level metadata removal across 13 formats | `mellivora-scrub` (JPEG/PNG/WebP native) |

Instead of three CLIs, three GUIs, and three config files, there is one registry
of tools, one report format, one config, one audit trail, and one UI.

## Why this shape

The three projects already agree on more than they disagree on:

- Perl Den scripts return `\%result` and render with `format_report`.
- HB_Scrub operations return `{ data, format, removedMetadata, warnings }`.
- DarkStar services return typed results with an audit record.

That shared shape — *structured result plus findings* — is the contract this
repository formalizes as [`Report`](crates/core/src/report.rs). Everything else
follows from it:

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
        ┌─────┴─────┐        (DarkStar)         (HB_Scrub ports)
        │ perlden   │
        │ pack      │  JSON-RPC over stdio — any language
        └───────────┘
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and the
rationale behind each decision.

## Quick start

```bash
# 1. build
cargo test --workspace
cargo build --release

# 2. wire up the Perl Den compatibility pack (one shallow clone)
./scripts/link-sources.sh

# 3. use it
./target/release/mellivora tools list
./target/release/mellivora system-info
./target/release/mellivora passgen length=32
./target/release/mellivora metadata-scan input=photo.jpg
./target/release/mellivora metadata-strip input=photo.jpg profile=archive redact_gps=city
./target/release/mellivora run perlden.failed-login-detector
```

Every tool also works over HTTP and in the shared UI:

```bash
./target/release/mellivora serve --ui-dir packages/ui/dist
# → http://127.0.0.1:7878
```

Desktop shell:

```bash
cargo run -p mellivora-cli -- serve      # terminal 1
cd apps/desktop && npm install && npm run dev   # terminal 2
```

## What works right now

| Area | Status |
|---|---|
| `Report` contract, registry, config, audit trail | ✅ complete |
| Plugin protocol + host (JSON-RPC, timeouts, capabilities) | ✅ complete |
| CLI: `run`, `tools`, `plugins`, `config`, `audit`, `doctor`, `serve` | ✅ complete |
| HTTP API + shared UI + Tauri shell | ✅ complete (thin surfaces) |
| `sysadmin.system-info`, `sysadmin.disk-usage` native | ✅ ported from Perl Den |
| All 20 Perl Den modules via `perlden` pack | ✅ live, including its `run`/`format_report` contract |
| `crypto.passgen`, `crypto.sha256` | ✅ native, CSPRNG + SHA-256 |
| Metadata scan/strip/verify for JPEG, PNG, WebP | ✅ native, byte-preserving |
| Privacy profiles, field-level keep/remove, GPS redaction | ✅ native |
| DarkStar crypto engine (AEAD, signatures, HBZF, keystore) | ⏳ `CryptoBackend` seam defined |
| Remaining 10 metadata formats, metadata injection | ⏳ `hb-scrub` pack, then native ports |
| WASM target, TUI, scheduler | ⏳ roadmap |

## Layout

```
crates/
  core/       contracts, registry, config, audit, plugin host   (no domain logic)
  sysadmin/   native sysadmin tools
  crypto/     crypto tools + CryptoBackend seam
  scrub/      metadata inspection/removal
  server/     HTTP API
  cli/        `mellivora` binary (composition root)
packages/ui/  one TypeScript UI for browser + desktop
apps/desktop/ Tauri 2 shell
plugins/      language packs (perlden-pack today)
docs/         architecture, plugin SDK, migration plan, ADRs
scripts/      developer tooling (source linking)
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

## Development

```bash
make check      # fmt, clippy, tests — everything CI runs
make test       # cargo test --workspace
make ui         # type-check + build the shared UI
make doctor     # cargo run -p mellivora-cli -- doctor
```

Requirements: Rust 1.82+, Node 20+ (UI only), Perl 5.28+ (Perl Den pack only).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — layers, contracts, dependency rules
- [Plugin SDK](docs/PLUGIN_SDK.md) — write a pack in any language
- [Migration plan](docs/MIGRATION.md) — what moves, in what order, and why
- [Roadmap](docs/ROADMAP.md) — phases and acceptance criteria
- [Enhancements](docs/ENHANCEMENTS.md) — proposed features, prioritized with effort and risk
- [ADRs](docs/adr/) — decisions and their trade-offs
- [Security](SECURITY.md) — threat model and data-handling guarantees

## License

MIT — see [LICENSE](LICENSE).

© 2026 Honey Badger Universe
