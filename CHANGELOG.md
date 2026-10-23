# Changelog

All notable changes to Mellivora ToolKit. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Removal policies, GPS redaction, and CI-friendly exit codes.

### Added

- **Removal policies.** `privacy.metadata-{scan,strip,verify}` accept
  `profile=privacy|sharing|archive` plus comma-separated `remove=` and `keep=`
  overrides. `keep` always wins, so a broad profile cannot remove something by
  accident. Segments now carry a `category` (`identity`, `text`, `time`,
  `structural`, `color`); structure and colour are never removable.
- **GPS redaction.** `redact_gps=off|country|region|city` truncates coordinates
  in place to a 1°, 0.1°, or 0.01° grid, leaving the rest of EXIF (camera, dates)
  intact. Because the replacement is the same size, no offsets move. Works for
  JPEG `APP1`, PNG `eXIf`, and WebP `EXIF` payloads, big- and little-endian.
- **`--strict`.** Warning verdicts exit with status 1 so CI can gate on findings
  rather than only on errors.
- **`docs/ENHANCEMENTS.md`.** Prioritized backlog with effort and risk.

### Changed

- `Segment.removable` was replaced by `Segment.category`; `metadata_bytes` now
  means "removable under the default policy", and reports add
  `removable_bytes` for the policy actually in use.
- Reports from the privacy tools include the resolved policy and, when
  applicable, the post-redaction coordinates (never the originals).
- The smoke test now covers profiles, GPS redaction, and `--strict`.

### Fixed

- Redaction warnings are no longer dropped when a run has nothing to remove.
- A malformed EXIF block is an error when redaction is requested, rather than a
  silent no-op.
- The WebP test fixture declared a RIFF size four bytes too small, which hid the
  fact that `strip_with` recomputes it correctly.

## [0.1.0] — 2026-10-23

First release: one contract, one registry, and three domain modules
(system, crypto, privacy) with a shared CLI, HTTP API, and UI.

### Added

- **Core** (`mellivora-core`): `Tool` / `ToolManifest` / `Report` contracts,
  registry with built-in precedence and fuzzy suggestions, versioned TOML config
  with module namespaces, JSONL audit trail that records argument names only,
  capability model, JSON-RPC plugin host with timeouts and per-pack failure
  isolation.
- **Sysadmin** (`mellivora-sysadmin`): native `system-info` and `disk-usage`
  ports of the Perl Den modules, with pure `/proc` and `df` parsers and
  configurable thresholds.
- **Crypto** (`mellivora-crypto`): `CryptoBackend` seam, OS CSPRNG backend,
  `passgen` (unbiased sampling, guaranteed character classes, entropy estimate)
  and `sha256`.
- **Privacy** (`mellivora-scrub`): metadata scan, strip, and verify for JPEG,
  PNG, and WebP — byte-preserving, verified before write, `--dry-run` aware.
- **Surfaces**: `mellivora` CLI (`run`, `tools`, `plugins`, `config`, `audit`,
  `doctor`, `serve`, plus tool shorthand), HTTP API, shared TypeScript UI, and a
  Tauri 2 desktop shell.
- **Packs**: the first compatibility pack, exposing external system-audit
  modules over the plugin protocol, including UTF-8 normalization for sources
  that do not declare `use utf8`.
- **Tooling**: CI (fmt, clippy, tests, UI build, live Perl slice), Makefile,
  `deny.toml`, source-linking script, smoke test, architecture/plugin/migration
  documentation and ADRs.

### Fixed

- `df` rows with wrapped device names are rejoined instead of dropped.
- Custom `Display` implementations now honour format width, fixing CLI column
  alignment.
- Plugin directories are canonicalised before launch, so packs that walk up from
  their own directory resolve correctly.
- Packs can declare a `timeout_ms` override for tools that legitimately run long
  (filesystem walks); the host default rose from 10 s to 30 s after the Perl Den
  disk-usage module exceeded the old limit on a cold cache.

### Known limitations

- The native crypto engine is not implemented yet (`CryptoBackend` seam only).
- Ten of thirteen target metadata formats are not native yet; they return an explicit
  `unsupported` error naming the pack to install.
- No scheduler, TUI, WASM target, or API authentication.
