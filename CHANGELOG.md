# Changelog

All notable changes to Mellivora ToolKit. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Native cryptography: authenticated file encryption, Ed25519 signatures, and the
`.melv` container. Plus removal policies, GPS redaction, a workbench interface,
a self-contained desktop app, and CI-friendly exit codes. Batch execution, a
manifest that says whether a tool writes, and a workbench that reports what it
did.

### Added

- **`mellivora batch`.** Run one tool over many files:
  `mellivora batch privacy.metadata-strip ~/Pictures --ext jpg`. Expands
  directories, binds each path to `--input-arg` (default `input`), runs with
  `--concurrency` (default 4, capped at 32), and prints one aggregate report
  with a per-file entry. `--fail-fast` stops after the first failure and reports
  what was skipped; `--ext` and `--no-recursive` narrow the file set. A failing
  file never aborts the batch silently, and the aggregate status is derived from
  the per-file findings like every other report.
- **`mutates` on `ToolManifest`.** `crypto.encrypt`, `crypto.decrypt`,
  `crypto.keygen`, `crypto.sign`, and `privacy.metadata-strip` declare that they
  write; everything else is read-only by default, including packs written before
  the field existed. `mellivora tools list` gained a `WRITES` column.
- **`GET /api/v1/audit?limit=N`.** Recent runs from the local audit trail as
  JSON (`enabled`, `path`, `entries`); argument names only, never values.
- **Workbench: packs and history.** The packs button lists every loaded pack
  with its version, tool count, capabilities, and directory; the clock button
  shows recent runs, and clicking one opens its tool.
- **Workbench: reproducible runs.** Every report shows the equivalent
  `mellivora run …` command, copyable in one click, and can be downloaded as
  JSON.
- **Desktop: the window now loads the embedded bundle.** `apps/desktop` declares
  the `custom-protocol` feature, so a release build serves the UI compiled into
  the binary instead of pointing the webview at the dev server. Before this, a
  plain `cargo build --release` opened a window reading *"Could not connect to
  localhost"*.
- **Desktop: window lifecycle is visible.** The shell reports close and destroy
  events on stderr, so a clean exit is explainable instead of mysterious.
- **UI test suite.** `vitest` covers search, argument validation and coercion,
  CLI command rendering, data rendering, and — against a jsdom shell with a
  mocked API — boot, a full run, validation blocking, drafts surviving a tool
  switch, the read-only/dry-run split, and both sheets. Wired into CI and
  `make ui-test`.

- **Self-contained desktop app.** The Tauri window now hosts the engine: it
  binds an ephemeral loopback port, runs the same `Runtime` the CLI uses on a
  background thread, and hands the port to the window before its first script.
  No second process, no fixed port, and no configuration; packs are discovered
  beside the binary or in the checkout.
- **`mellivora-toolkit` composition crate.** Module wiring and the serve
  helpers moved out of the CLI, so the CLI and the desktop shell cannot drift
  apart: both build their registry from `Runtime`. `serve_on_listener` lets a
  caller bind first and serve later.
- **Workbench interface.** A proper application shell replaces the previous
  single-page dump: category filters and search, forms generated from each
  tool's manifest, results rendered as findings, report bodies, and
  tables/key-value views (with a JSON tab and copy), dry-run switch,
  dark/light themes, persisted selection, and keyboard shortcuts
  (`Ctrl/⌘ K`, `Ctrl/⌘ ↵`). Split into `lib/`, `components/`, and `styles/`.
- **Native crypto engine.** `CryptoBackend` now has a real implementation:
  AES-256-GCM, ChaCha20-Poly1305, Argon2id, Ed25519, SHA-256, and OS randomness,
  with secrets in zeroizing buffers.
- **`.melv` container v1.** Self-describing encrypted file: magic, version,
  cipher id, KDF parameters, salt, and nonce in an authenticated header.
  Header tampering fails decryption; parameter bounds are checked before key
  derivation. Specified in `docs/CONTAINER.md`.
- **Tools:** `crypto.encrypt`, `crypto.decrypt`, `crypto.inspect`,
  `crypto.keygen`, `crypto.sign`, `crypto.verify`.
- **`--overwrite` guard** on encrypt/decrypt: an existing output file is never
  replaced silently.
- Known-answer tests: NIST AES-256-GCM (case 13), RFC 8032 Ed25519, plus
  round-trip, tamper, and wrong-passphrase coverage.
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

- **Workbench UX.** Search now covers capabilities and argument names, as its
  placeholder always claimed. Arrow keys move through the tool list and every
  option is reachable by keyboard; required fields are validated before a
  request is sent, with the offending field focused and announced; form values
  survive a tool switch; the last report per tool is kept; a dry run is offered
  only for tools that write, and read-only tools say so; reports from a dry run
  carry a "nothing was written" banner; section headings in structured data are
  capitalised like every other label.
- **CLI internals.** `commands.rs` no longer duplicates pack-failure rendering,
  and argument parsing is shared between `run` and `batch`.

### Removed

- `packages/ui/src/api.ts`, a duplicate of `lib/api.ts` that had already drifted
  (no `fetchPacks`, no offline message), plus the unused `sliders` and `plug`
  icons.
- `packages/ui/src/style.css`, a stylesheet nothing imported; `styles/` is the
  single source of styling.
- Dead store helpers left over from the previous interface.

### Fixed

- `Segment.removable` was replaced by `Segment.category`; `metadata_bytes` now
  means "removable under the default policy", and reports add
  `removable_bytes` for the policy actually in use.
- Reports from the privacy tools include the resolved policy and, when
  applicable, the post-redaction coordinates (never the originals).
- The smoke test now covers profiles, GPS redaction, and `--strict`.

- A pack listed twice when `MELLIVORA_PLUGIN_PATH` named a directory that was
  also discovered relative to the working directory: `plugins` and
  `/abs/path/plugins` are the same directory with two spellings. Plugins are now
  deduplicated by canonical path, so each pack process starts once.
- `mellivora … | head` panicked with a broken-pipe backtrace when the reader
  closed early; the CLI now ends quietly, as a shell pipeline expects.
- `ArgSpec` serialized as `{"name": ..., "kind": {"type": ...}}` while the
  documented contract promised a flat `type`. It is now flattened, so consumers
  can build forms from the wire shape (the UI previously rendered booleans and
  enums as text inputs because of this).
- The sidebar lost its scroll position, and then its selection, after choosing a
  tool; it now keeps both in view.
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
