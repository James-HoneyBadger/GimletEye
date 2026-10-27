# Changelog

All notable changes to Gimlet Eye. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- **The dev toolchain no longer carries known vulnerabilities.** `npm audit`
  reported six advisories in the test and build tooling — two critical
  (`vitest` 2.1.9, `tinypool`), one high (`vite` 5.4.21), three moderate — all
  reachable through the old `vitest` line. `vitest` moves to `^4.1.12`, whose
  fixes land in 4.1.11+, and `vite` is held on the patched `^6.4.5` line. Vite 7
  and `vitest` 5 would have been simpler, but they require Node 20.19+/22.12+
  while this build declares Node 20+, so they stay out until that floor moves.
  `apps/desktop` now declares `@types/node` and lists it in `types`, because
  `vite` 6 stopped referencing node types implicitly and its tests import
  `node:fs`. `npm audit` is clean; no runtime dependency changed.

### Changed

- **The dependency policy is enforced now.** `deny.toml`, the desktop shell's
  `apps/desktop/src-tauri/deny.toml`, and the Gate 2 row in
  `scripts/check-release-gates.sh` all described a `cargo deny` check that no
  workflow ran, so a new advisory in either Cargo graph could reach `main`
  unremarked. A `dependency policy` job now runs `check` on the root graph and
  `check advisories` on the shell's own lockfile, where the two accepted GTK3
  findings are listed with the reasoning for accepting them.

- **The surfaces are TypeScript, over one Rust engine.** The HTTP API, the
  browser surface, the API token, the Rust CLI, and the pack protocol are gone:

  | Removed | Was |
  |---|---|
  | `gimlet serve`, `/api/v1/*`, `api-token` | a local HTTP API and a browser build |
  | `gimlet plugins …`, `mellivora-pack.toml`, `[plugins]`, `[trust]` | the JSON-RPC pack protocol |
  | `ToolManifest.origin` and `.version` | pack provenance |

  What replaced them:

  - `packages/core` — catalogue, report contract, arguments, configuration,
    audit trail, and the engine client. Shared by both surfaces, so they cannot
    drift apart.
  - `packages/cli` — `gimlet`, now a Node CLI. Same commands minus `serve` and
    `plugins`; same exit codes.
  - `apps/desktop` — the Tauri window, whose frontend imports `packages/core`
    directly. No port, no token, no web page can drive it.
  - `crates/sidecar` — `gimlet-sidecar`, the crypto and metadata engine both
    surfaces spawn. It runs only the tools this build compiled.

  `sysadmin.system-info` and `sysadmin.disk-usage` are now TypeScript; crypto and
  metadata parsing remain in Rust, where the fuzz corpora, the fixtures, the
  Python second implementation, and the GPG interop tests already live. A config
  file that still carries `[plugins]`, `[api]`, or `[trust]` loads, and those
  sections are ignored.

  The `gimlet` binary now requires Node 20+ and must be installed beside
  `gimlet-sidecar` (or `GIMLET_SIDECAR` set) — a lone binary is no longer enough
  to run the crypto tools. The package layout is one definition, in
  `scripts/stage-package.sh`, used by the deb, rpm, and Arch recipes.
  **This restarts the two-release countdown to 1.0** (ADR 0006, ADR 0008).

- **The project is now Gimlet Eye.** Mellivora is the name of a different project
  family, and this toolkit shares nothing with it but a name. The rename reaches
  the parts other people build against, so it is a breaking release:

  | Was | Is |
  |---|---|
  | `mellivora <tool>` | `gimlet <tool>` |
  | `mellivora-core`, `-crypto`, `-scrub`, `-sysadmin`, `-server`, `-toolkit`, `-cli` | `gimlet-eye-*` |
  | `MellivoraError` | `GimletEyeError` |
  | `MELLIVORA_HOME`, `MELLIVORA_PLUGIN_PATH`, and the rest | `GIMLET_HOME`, `GIMLET_PLUGIN_PATH`, … |
  | `~/.config/mellivora` | `~/.config/gimlet` |
  | `keystore.melv` | `keystore.gimlet` |
  | `.melv` / magic `MELV` | `.gimlet` / magic `GIML` |
  | `mellivora-pack.toml` | `gimlet-pack.toml` |
  | `@mellivora/ui` | `@gimlet-eye/ui` |

  Three things keep reading what the old name wrote, so an upgrade does not
  orphan data: a home directory at `~/.config/mellivora` is used when no
  `~/.config/gimlet` exists, a container that starts with `MELV` opens exactly
  like one that starts with `GIML` (nothing else in the format moved), and a pack
  manifest named `mellivora-pack.toml` loads. New files are written under the new
  names. A pinned pack has to be re-pinned because its digest covers the manifest
  filename.

  Deliberately frozen: the HKDF label `melv-v3-recipient`, which is bound into
  every v3 container already written.

  The quiet countdown to 1.0 restarts, because a release that renames the crate
  names, the binary, and the environment variables is not a quiet one.

### Fixed

- **The desktop window could not reach its own engine.** On Linux the webview
  loaded Tauri's embedded assets on `tauri://localhost` and then fetched
  `http://127.0.0.1:<port>`; WebKitGTK refuses that cross-scheme request, so the
  first health call failed, the catalogue stayed empty, and the pillar cards
  rendered greyed out with no explanation. The window now loads the bundle from
  the engine's own listener, so page and API share an origin.
- **A failed startup is no longer silent.** The workbench rendered `state.error`
  only inside a selected tool's result panel, so a boot failure looked exactly
  like a healthy empty catalogue. It now says what failed, names the endpoint,
  and offers a retry.
- **GPS redaction was not idempotent.** Three separate causes, all of which moved
  a stored coordinate a little on every run while the report looked correct: a
  float round-trip that dropped a whole grid step, two tags sharing one rational
  array, and a value pointer aimed at the IFD entry table. The first is fixed by
  rounding to whole seconds before snapping to the grid; the other two are now
  refused, naming the ranges involved, instead of being half-written.
- **A `.gimlet` file could make decrypting cost minutes.** The container format
  accepts up to 1 GiB of Argon2id memory and 16 iterations, which is right for a
  format but wrong for a tool pointed at a file someone sent you: a 75-byte
  header asking for 595 MiB and nine iterations held a core for 42 seconds before
  the chunk check rejected it. `crypto.decrypt` now refuses anything above 256 MiB
  / six iterations in a quarter of a second, names the parameters, and takes
  `allow_expensive=true` when the operator vouches for the file. The format
  itself is unchanged.
- **A run that failed left no audit entry.** Both the CLI and `POST /api/v1/run`
  recorded only after a tool returned a report, so an attempt to guess a
  passphrase was invisible in the trail. Failures are recorded with
  `status: error`, the elapsed time, and argument *names* only, as before.

### Added

- **The window is Electron now, and Tauri is gone.** The renderer holds no
  `Runtime` and no key material — it asks the main process for a catalogue, a
  report, or the audit tail over four fixed IPC channels, so a keystore
  passphrase and decrypted bytes no longer exist inside a webview. `contextIsolation`,
  `sandbox`, denied navigation, refused permissions, validated IPC arguments, and
  a single-instance lock. The shell is TypeScript, so the desktop job no longer
  installs webkit2gtk or runs `cargo`, and `apps/desktop/src-tauri`, its
  `deny.toml`, and the two GTK advisories accepted there are deleted — Dependabot
  alert #1 closes with them. Installers come from `electron-builder`
  (deb, AppImage, dmg, nsis); `scripts/stage-engine.sh` still ships the sidecar
  for the tools ADR 0010 has not ported yet.
- **A Rust-free platform is chosen for the window.** With the engine in
  TypeScript, the last Rust is the 385-line Tauri shell. [ADR 0011](docs/adr/0011-rust-free-application-platform.md)
  selects Electron with the runtime moved into the main process: the webview
  becomes a pure view, so a keystore passphrase and decrypted bytes stop
  crossing into a renderer at all. The cost is honest and recorded — an install
  grows from about 10 MB to about 150 MB, reversing ADR 0003's size judgement,
  which was made when Rust was still acceptable. Neutralino was the runner-up
  and loses because it cannot host the Node engine, so it would reintroduce the
  sidecar boundary this work is removing.
- **Stage 4 begins: four engine tools now run in process.** `crypto.sha256`,
  `crypto.passgen`, `privacy.metadata-scan`, and `privacy.metadata-verify` are
  TypeScript tools over the ported engine, with the engine's manifests, argument
  names, and report keys. The migration is tool by tool rather than a flag day:
  `Runtime` registers local tools first and the sidecar serves whatever is not
  ported yet, so the CLI never loses a tool. These four were chosen because they
  are read-only — `privacy.metadata-strip` waits for GPS redaction, the last
  piece of the scrub crate not yet ported.
- **Stage 3 of retiring Rust: metadata scrub, and it is byte-identical.**
  `packages/engine/src/scrub` walks JPEG segments, PNG chunks, and WebP chunks,
  classifies each one, and removes only identity, text, and time — structure and
  colour decide what the pixels mean, so they are never touched. The acceptance
  test is the Rust corpus itself: all six fixtures reproduce the recorded byte
  length *and* SHA-256 under `privacy`, `sharing`, and `archive`, so this is not
  a reimplementation that "works", it is the same bytes. WebP additionally
  clears the VP8X EXIF/XMP presence flags — but only for chunks actually
  removed, so `archive` leaves the header truthful.
- **Stage 2 of retiring Rust: keys, signing, hashing, passphrases, and the
  sealed keystore.** `packages/engine` now generates Ed25519 and X25519 keys,
  reads and writes the frozen key-file JSON, signs and verifies, hashes, and
  generates passwords without modulo bias or fixed-class positions. The keystore
  is what ADR 0007 said it should be — a `.gimlet` container whose plaintext is
  the schema-1 JSON, written owner-only through a temporary file and renamed —
  so a wrong passphrase fails the AEAD tag before any JSON is parsed. A test
  pins the encoded document byte for byte against the shape the Rust writer
  emitted.
- **A TypeScript container engine, stage 1 of retiring Rust.** `packages/engine`
  reads version 1, 2, and 3 `.gimlet` containers and writes 2 and 3, using
  `node:crypto` for AES-256-GCM, ChaCha20-Poly1305, X25519, and HKDF, and
  `@noble/hashes` for Argon2id — the one primitive Node does not expose. The
  acceptance test is not a round trip: the committed v1 and v3 fixtures, written
  by 0.2.0 and 0.5.0, must open byte for byte, and the independent Python reader
  must read what the new writer emits. Both do. [ADR 0010](docs/adr/0010-retire-rust.md)
  records the remaining stages and the assurance that is lost with `cargo fuzz`.
- **Two more system-administration tools**, both TypeScript and read-only.
  `sysadmin.kernel-hardening` reads the sysctls that decide what one user can
  learn about another — ASLR, `kptr_restrict`, `dmesg_restrict`, Yama ptrace
  scope, unprivileged BPF, `perf_event_paranoid`, protected hardlinks and
  symlinks, IP forwarding — and grades each one, reporting a setting the kernel
  does not expose as *missing* rather than as a pass.
  `sysadmin.network` lists every interface with its state, MTU, and hardware
  address and resolves the default route out of `/proc/net/route`. Both read
  `/proc` and `/sys` directly, with no `exec` and no locale to depend on.
- **A terminal surface.** `gimlet tui` browses the catalogue, filters it by any
  word, prompts for the arguments a tool declares, and renders the same report
  the CLI would print. It goes through `Runtime.run`, so its runs are audited
  like any other, and its state machine, key decoder, and frame renderer are
  pure functions tested without a TTY.
- **A report you can hand to someone.** `--format html` writes one self-contained
  page — inline CSS, `default-src 'none'`, no script and no outbound reference —
  so a scan result can be filed or attached without the recipient installing the
  toolkit, and without the document being able to make a request when opened.
  This is [ADR 0009](docs/adr/0009-four-surfaces.md): the web surface is a
  viewer, not a server, so 0008's "no port, no token" still holds.
- **`docs/TOOL_REFERENCE.md`** — an example, with the output it actually
  produced, for all 39 tools, generated by `scripts/tool-reference.py` in a
  throwaway home. `check-tool-reference.sh` fails when a tool exists that the
  reference does not show, or when the reference was generated by an older build.
- **The CLI and HTTP surfaces are listed as public API** in
  [COMPATIBILITY.md](docs/COMPATIBILITY.md), and `check-public-surface.sh`
  compares those tables with the binary's `--help` and the router, so a new flag
  or route cannot ship undocumented.
- **Container fuzzing.** `crates/crypto/fuzz` soaks the `.gimlet` reader alongside
  the four scrub parsers, including an assertion that an expensive header is
  refused *before* the key is derived. A failed night now opens an issue, because
  the soak is a release gate and a red night noticed six days later is a red
  night ignored.
- **`make gates`** — one command that reports every 1.0 gate as verified now,
  verified by the newest green CI run, or open with its reason; and
  **`make fuzz-nights`**, which reads the scheduled soak history and refuses to
  count a dispatched run, a cancellation, or a missing night.
- **A `.gimlet` a second implementation can read**: `crates/crypto/tests/interop/`
  is a reader written from [CONTAINER.md](docs/CONTAINER.md) alone, run in CI
  against the v1 and v3 fixtures and a multi-chunk file this build writes.
- **Tests for paths that had none:** keystore rotation (old passphrase retires,
  key material survives, `--dry-run` changes nothing, refusals are safe), strip
  idempotency through the tool, and all seven HTTP routes in `smoke.sh`.

### Changed

- The desktop bundle ships the built UI as a resource, and the desktop CI job
  builds that bundle before type-checking the shell — Tauri refuses a missing
  resource path.

## [0.7.0] — 2026-10-26

The first release since 0.3.0, and the last quiet one: everything below is
additive or a fix, no versioned surface changed meaning, and the two-release
countdown to 1.0 now has one tick behind it.

### Added

- **Packaging for Arch, Debian, and Fedora**, plus `cargo install` from a tag.
  `scripts/check-packaging.sh` fails when any of them names a version other than
  the workspace's, and CI builds the `.deb` on every push so a broken
  `debian/rules` cannot reach a release.
- **Releases are reproducible and signed.** Builds remap absolute paths and skip
  incremental compilation, so the same tag produces the same bytes; a release job
  rebuilds from a second directory and refuses to publish on a mismatch.
  `SHA256SUMS` is signed with minisign, and the workflow refuses an unsigned
  release unless an operator says so explicitly. `scripts/verify-release.sh`
  checks signature and checksums together, and treats a missing signature as a
  failure rather than a warning.
- **An upgrade rehearsal in a container**: install, create a sealed key, upgrade
  to the next patch version, roll back, and upgrade again — asserting the key id
  survives, the keystore stays 0600, and the audit trail only grows. It runs on
  every push.
- **A user guide, an admin guide, and a pack gallery**, the last with a complete
  example pack that passes `gimlet plugins conformance`.
- **Recorded throughput.** `cargo run --release -p gimlet-eye-toolkit --example
  bench` measures scan, strip, and encrypt at 10 MiB and 1 GiB, prints JSON, and
  fails under a floor; a CI job runs it and keeps the numbers. On this machine:
  strip 1 GiB in 1.2 s (832 MiB/s), encrypt 1 GiB in 3.3 s (309 MiB/s). Scan is
  measured and reported as *header only* — it walks container structure, not
  pixel data, so a throughput figure for it would be a lie told in MiB.
- **A live-engine UI test.** `packages/ui/e2e` drives a real `gimlet serve`
  with Playwright: the token gate, browsing, validation that blocks a run,
  a known-answer run, and the token surviving a reload. `vitest` mocks the API,
  so this is the only check that would notice wire drift between the UI and the
  engine — which is what a 1.0 freeze makes expensive. New `e2e` CI job.
- **`gimlet plugins conformance <dir>`** runs the SDK checklist instead of
  leaving it as a list in a document: manifest, handshake, tool ids, capability
  subset, unknown-tool handling (`-32001`), clean shutdown, and the pack's own
  language syntax. It reports the three items only a human can judge as
  `manual` rather than claiming they passed, and it never dispatches a tool.
  Writing it found a real deviation in the reference pack: it answered an
  unknown tool with `-32003` (execution failed), so a caller looked at its own
  arguments instead of at a stale tool id.
- **Pack trust pinning.** `gimlet plugins pin <dir>` prints a digest over
  every file in the pack (path, size, content), and `[trust]` in the config
  refuses a pack whose digest does not match, listing it as a failure with both
  values. Unpinned packs load as before, so pinning one does not disable the
  others, and a pin for a pack that is not installed is reported too.
- **A sealed keystore, and encryption to recipients.** `crypto.keygen
  kind=x25519 label=alice keystore=true` writes a key into
  `$GIMLET_HOME/keystore.gimlet` — one `.gimlet` container (Argon2id → AEAD, mode
  0600, atomic replace) holding a JSON document, so a wrong passphrase fails the
  tag before anything is parsed and there is no second format to keep
  compatible. `crypto.key-list`, `crypto.key-import`, `crypto.key-export`, and
  `crypto.key-rotate` manage it; no secret reaches `data`, the summary, the body,
  or the audit trail (asserted in the smoke test), and `Debug` prints
  `<redacted>`. Rotation re-seals the store under a new passphrase — key material
  is deliberately not regenerated, because that would invalidate signatures the
  user already published.
- **X25519 recipients and container version 3.** `crypto.encrypt
  input=… to=alice.pub` encrypts to one or more recipient keys and
  `crypto.decrypt input=… key=alice.key` opens it, so two people no longer need a
  shared secret. One ephemeral X25519 keypair per file, HKDF-SHA256 per
  recipient, and a random file key wrapped once for each of them; the chunk
  stream below the header is byte-for-byte the version 2 framing. A file for
  somebody else says "not encrypted for that key" rather than reporting a bad
  passphrase. v1 and v2 still open, and a committed `container-v3.gimlet` pins the
  format. See [CONTAINER.md](docs/CONTAINER.md#version-3-recipients).
- **OpenPGP interop through the system `gpg`.** `crypto.gpg-verify` checks a
  detached signature and `crypto.gpg-encrypt` produces an OpenPGP message, for
  people who already have GPG keys. Paths are passed as arguments (never through
  a shell), runs are `--batch` with no TTY, a missing `gpg` is reported as
  missing, and the test suite signs and encrypts with a real `gpg` in a
  throwaway keyring — including `gpg` decrypting what the tool produced. Behind
  the `openpgp` Cargo feature, on by default.
- **The quiet period is enforced, not remembered.** `scripts/check-quiet-period.sh`
  runs in CI and fails when `Report`, the plugin protocol, the config schema, or
  the container format moves after the last release — continuously, not just at
  audit time — plus the release-to-release stretches ADR 0006 counts. It is
  dormant until v0.5.0, since 0.4 and 0.5 are the releases that move surfaces.
- **A job builds the declared MSRV.** `msrv` in CI compiles every target on the
  `rust-version` from `[workspace.package]`, `--locked`, and
  `scripts/check-msrv.sh` fails when the manifest and the job disagree — so the
  number can no longer describe a toolchain nobody tested. The first run paid
  for itself immediately: it found the declaration was already wrong (see
  *Changed*).
- **The parsers are fuzzed.** `crates/scrub/fuzz` holds libFuzzer targets for
  JPEG, PNG, WebP, and EXIF/TIFF, seeded from a committed corpus and soaked
  nightly in `fuzz.yml`; `crates/scrub/tests/parsers_never_panic.rs` runs the same
  entry points over the seeds plus a structural mutation sweep on every
  `cargo test`. Both assert the promise `metadata-strip` makes: a strip that
  succeeds leaves nothing for the policy to remove.
- **`Report.data` has a documented shape.** An object or an array of objects,
  `snake_case` keys, at most two levels of nesting, and strings that carry a
  value rather than a document — enforced by a test that runs every native tool
  and fails when a tool is added without a sample. See
  [COMPATIBILITY.md](docs/COMPATIBILITY.md#the-shape-of-reportdata).
- **Tools declare the platforms they run on.** `ToolManifest.platforms` is
  enforced by the registry, so `sysadmin.system-info` and `sysadmin.disk-usage` —
  which read `/proc` and parse `df` — return an `unsupported` error naming both
  sides instead of an empty report on macOS or Windows. `tools list` gained a
  `PLATFORM` column, and packs can declare the field too.
- **The local API requires a token.** `gimlet serve` generates one on first
  run (`$GIMLET_HOME/api-token`, mode 0600), prints it, and answers `401` to
  any `/api/` request without `Authorization: Bearer <token>`. The printed URL
  carries the token in its fragment so the workbench signs itself in; the desktop
  shell injects it into the window. `[api] require_token = false` turns it off and
  says so at startup.

### Changed

- **The nightly fuzz soak accumulates.** `fuzz.yml` caches the working corpus per
  target, so each night starts from everything the previous ones learned instead
  of from the eight committed seeds, and it seeds runs from the golden fixtures
  too. A local night's worth of soaking — 21.1 M executions across the four
  targets — is green, and the corpus grew from 8 committed seeds to 1 438 inputs.
- **`crypto.keygen` takes `kind` and `keystore` and reports `kind`.** A key is
  now Ed25519 *or* X25519, and it can live in the keystore instead of in two
  files. The old `algorithm` field stays in `data` next to `kind` for one minor,
  per the deprecation policy.
- **`CryptoBackend` grew five methods** — `x25519_keygen`, `x25519_public`,
  `x25519_shared`, `hkdf_sha256`, `ed25519_public` — because a recipient
  container cannot be built from a hash and an AEAD alone. An alternative engine
  has to implement them; the native one covers all of it.
- **The declared MSRV is 1.85, not 1.82.** 1.82 was never true: `zeroize`,
  `tokio`, `clap`, and `hashbrown` all require 1.85, and Cargo 1.82 cannot even
  parse `zeroize_derive`'s edition-2024 manifest. Nothing this project writes
  needs 1.85 — the dependency graph does. The desktop shell, which is a separate
  workspace, now declares the 1.90 that Tauri 2.12 imposes.
- **`sysadmin.system-info` reports `load.avg_1m` / `avg_5m` / `avg_15m`** instead
  of `load.1m` / `5m` / `15m`, so its keys satisfy the `Report.data` convention.
  This is the kind of rename the 1.0 freeze will make expensive; better now.

### Fixed

- **A pack is told when the run is a dry run.** The host sent `run_tool` with
  the tool id and its arguments and nothing else, so a pack that would write had
  no way to know the user asked it not to - which made the SDK rule "honour
  `--dry-run`" unimplementable, not merely unenforced. `dry_run` now travels
  beside `args`; packs that ignore it keep working, and the protocol version
  stays 1 because nothing changed meaning.
- **The three pillars on the empty screen are buttons, not decoration.** System,
  Crypto, and Privacy were `<div>`s styled as cards: the most inviting thing on
  the screen did nothing when clicked. They are now buttons that narrow the
  catalogue to that pillar and open its first tool. Two consequences fell out of
  making them real: the workbench no longer picks a tool for you on a first run
  (a remembered tool is still restored, so the landing screen costs one click
  once), and a pillar with nothing in it renders disabled with a count of `0`
  instead of looking alive while the catalogue is still loading.
- **A short list of choices is a row of buttons, not a dropdown.** The `kind`,
  `algorithm`, `profile`, and `redact_gps` arguments were `<select>` elements,
  which depend on a native popup the WebKitGTK webview does not open reliably
  inside the desktop window — so picking a type could do nothing at all. Up to
  four values now render as a radio group styled as buttons (one click per
  option, real radios so arrow keys and screen readers still work); longer lists
  keep the dropdown. Choosing one also persists in the form draft, which the old
  control did not do on every platform.

- **CLI `key=value` text is no longer rewritten.** Only canonical numbers and
  `true`/`false` are coerced; `passphrase=0123`, `input=-0`, and any other value
  that merely looks numeric stays exactly as typed, so a passphrase can no
  longer be silently changed to `123`.
- **`crypto.sign` refuses to write over its input and no longer replaces an
  existing signature silently.** It gains `overwrite`, matching `crypto.encrypt`
  and `crypto.decrypt`.
- **`privacy.metadata-strip` writes through a temporary file and renames into
  place**, so an interrupted run cannot leave a truncated photo — which matters
  most with `in_place=true`, where the destination is the only copy. It refuses
  an `output` that is the input (use `in_place=true`, which is explicit), gains
  `overwrite`, and preserves the original file's permissions when rewriting.
- **The local API answers CORS only for the desktop window, the Vite dev
  server, and loopback origins** instead of `*`, so a page the user visits can
  no longer drive local tools through the browser. A non-loopback bind is
  refused unless `serve --allow-remote` is passed.
- **Pack capabilities are enforced as documented.** A pack whose tools request
  a capability its manifest omits now fails to load, and `plugins.allow` gates
  every tool of a pack whose declared capabilities were not granted — previously
  a tool that declared nothing ran regardless of what its pack declared.
- **`[defaults] output` in the configuration is honoured.** It was parsed,
  serialized and documented but never applied, so `output = "json"` did
  nothing. `--format` and `--json` still win, because a per-run choice must not
  be overridden by a file someone else wrote.
- **`sysadmin.disk-usage path=<relative>` resolves the path first.** `df`
  reports absolute mount points, so `path=.` could never match one and the tool
  answered "no mounted filesystem contains .".
- **`container::open` reads chunked containers.** Handing a version 2 file to the
  in-memory helper fed the chunk stream to a whole-file AEAD and surfaced as
  "wrong passphrase or corrupted file"; it now delegates to the streaming
  reader, so the two entry points cannot disagree.
- **Pack replies must echo the request id.** A notification (a line with no `id`)
  was accepted as the answer to the request in flight, which left the next call
  reading a stale reply and everything after it off by one.
- **Audit pruning is atomic and serialised.** The trim rewrote `audit.jsonl` in
  place, so a concurrent recorder could lose a record or a reader could see a
  half-written trail. It now goes through a temporary file and a rename, under
  a lock shared by every clone of the log.
- **`gimlet batch` reports wall-clock duration** instead of the sum of the
  per-file times, which overstated a `--concurrency 4` run by about 4x in both
  the report and the audit entry.
- **GPS redaction reports below-sea-level altitude as negative.** EXIF stores
  altitude as a magnitude and keeps the sign in `GPSAltitudeRef`; the report
  ignored that tag, so a redacted altitude below sea level read as positive.

## [0.3.0] — 2026-10-24

Encryption no longer depends on how big the file is. Containers written from
this release are version 2 (chunked); every earlier container still opens.


### Added

- **Chunked `.gimlet` container (version 2).** `crypto.encrypt` now writes a
  header plus 64 KiB AEAD chunks instead of one message over the whole file, so
  memory no longer grows with the input: peak RSS measured at 22.7 MiB for both
  a 512 MiB and a 2 GiB file, against 1539.5 MiB for the same 512 MiB file under
  version 1 — and it is roughly twice as fast, because the old path copied the
  plaintext and ciphertext several times. Each chunk authenticates the header,
  its position, and its final flag, so reordering, truncation, splicing, and
  trailing data are authentication failures. `crypto.decrypt` and
  `crypto.inspect` read both versions; a genuine 0.2.0 container is committed as
  a compatibility fixture. Specified in [docs/CONTAINER.md](docs/CONTAINER.md),
  decided in [ADR 0005](docs/adr/0005-chunked-container-v2.md).

### Changed

- `crypto.encrypt`, `crypto.decrypt`, and `crypto.inspect` report
  `container_version`; the encrypt report adds `chunk_size_bytes` and `chunks`.
  Inspect reads only the header, so inspecting a huge container is instant.
- A container is written to a sibling temporary file and renamed into place, so
  a failure part-way through cannot leave a plausible-looking file at the
  destination.
- Encrypt and decrypt refuse an `output` that is the `input`, which would
  truncate the source before it is read.

## [0.2.1] — 2026-10-24

The release pipeline that 0.2.0 promised, and the icon set it needed to build on
Windows. Binaries and installers for 0.2.0 were never published; use this
release instead.

### Added

- **Release workflow.** A `v*` tag now builds the artifacts and attaches them to
  the release: CLI archives for Linux (x86_64, aarch64), macOS (x86_64,
  aarch64), and Windows (x86_64); `.deb` + `.AppImage`, `.dmg`, and NSIS
  installers for the desktop app; and a `SHA256SUMS` file. The publish job waits
  for every build, so a partial release is impossible.

### Fixed

- The desktop bundle shipped a single 128 px PNG as its icon, so a Windows build
  could not run at all: `tauri-build` needs `icons/icon.ico` for the resource
  file. The full set (`.ico`, `.icns`, and the sized PNGs) is generated from the
  brand mark and referenced from `tauri.conf.json`.

## [0.2.0] — 2026-10-24

Batch execution, a manifest that says whether a tool writes, an audit API, and a
workbench that reports what it did — on top of the native crypto engine,
removal policies, GPS redaction, and the self-contained desktop app that landed
in the previous cycle. Everything here came out of running the toolkit: the
last four fixes in this entry exist because a real run exposed them.

Highlights:

- `gimlet batch` runs one tool over a directory tree, with a per-file entry
  and one aggregate report.
- `./run.sh` builds what is stale and opens the native window, the browser
  workbench, or a hot-reloading window.
- Tools declare `mutates`, so a dry run is offered only where it means
  something, and the catalogue says which tools write.
- The workbench validates before it sends, keeps drafts and reports per tool,
  and shows the equivalent CLI command for every run.

### Added

- **Desktop advisory policy.** The shell's lockfile is excluded from the
  workspace, so the root `cargo deny` job never scanned it. It now has its own
  policy and a CI step: new advisories fail the build, and the two accepted
  GTK3-stack findings are documented in the file and in `SECURITY.md`.
- **`./run.sh`.** One entry point for the whole project: it builds what is out of
  date (UI, CLI, desktop binary) and launches the native window, the browser
  workbench (`--serve`), or a hot-reloading window (`--dev`). `--build` forces a
  rebuild; `--foreground` keeps the app attached to the terminal instead of
  detaching it.
- **`gimlet batch`.** Run one tool over many files:
  `gimlet batch privacy.metadata-strip ~/Pictures --ext jpg`. Expands
  directories, binds each path to `--input-arg` (default `input`), runs with
  `--concurrency` (default 4, capped at 32), and prints one aggregate report
  with a per-file entry. `--fail-fast` stops after the first failure and reports
  what was skipped; `--ext` and `--no-recursive` narrow the file set. A failing
  file never aborts the batch silently, and the aggregate status is derived from
  the per-file findings like every other report.
- **`mutates` on `ToolManifest`.** `crypto.encrypt`, `crypto.decrypt`,
  `crypto.keygen`, `crypto.sign`, and `privacy.metadata-strip` declare that they
  write; everything else is read-only by default, including packs written before
  the field existed. `gimlet tools list` gained a `WRITES` column.
- **`GET /api/v1/audit?limit=N`.** Recent runs from the local audit trail as
  JSON (`enabled`, `path`, `entries`); argument names only, never values.
- **Workbench: packs and history.** The packs button lists every loaded pack
  with its version, tool count, capabilities, and directory; the clock button
  shows recent runs, and clicking one opens its tool.
- **Workbench: reproducible runs.** Every report shows the equivalent
  `gimlet run …` command, copyable in one click, and can be downloaded as
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
- **`gimlet-eye-toolkit` composition crate.** Module wiring and the serve
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
- **`.gimlet` container v1.** Self-describing encrypted file: magic, version,
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
- `gimlet batch` walked directories without following symlinks, so a link
  named on the command line was processed while the same link found by walking
  was skipped. Symlinks are followed now, each directory is walked once by its
  real path, and a link cycle terminates.
- Choosing a tool with the pointer left focus on the list, so the next Tab went
  to the next tool instead of the form. Pointer selection now lands on the first
  field (or Run); keyboard selection keeps focus in the list.
- A required boolean argument was reported as missing when answered `false`,
  which blocked the run before anything was sent.
- The sidebar listed its groups in tool-id order while the category chips above
  were alphabetical, so the list did not follow the tabs.
- A sheet declared `aria-modal` but let Tab walk out of it; focus now cycles
  inside the panel and returns to the control that opened it.
- `gimlet batch` silently replaced `--arg <input-arg>=…` with the file path;
  it now refuses the combination and exits `2`.
- The batch report repeated `duration_ms` inside `data` as well as at the top
  level, unlike every other report.
- The structured-data view decided whether to warn about dropped columns from
  the first row only.
- The history badge in the title bar did not count the run that had just
  finished until the sheet was reopened.
- `run.sh` sent the desktop shell's log to `/dev/null`, hiding the engine
  address and window events; it is kept in `$TMPDIR/gimlet-desktop.log`.
- Documentation: `CONTRIBUTING.md` pointed at `crates/cli/src/app.rs` (now
  `crates/toolkit/src/runtime.rs`) and described a CI step that no longer
  exists; `COMPATIBILITY.md` promised config migrations and a pinned CI
  checkout that are not implemented; three documents disagreed on how many
  metadata formats exist, and the architecture's test and CI tables predated
  the UI suite; the README overstated how the `network` capability is enforced.
- The UI test suite needed Node 22 through `jsdom` 30's `undici`; `jsdom` is now
  pinned to 26, so the documented Node 20 baseline runs the tests.
- A pack source that has been renamed, deleted, or made private no longer fails
  `scripts/link-sources.sh`: it warns and the smoke test skips that pack.
  `REQUIRE_SOURCES=1` restores the hard failure.
- A pack listed twice when `GIMLET_PLUGIN_PATH` named a directory that was
  also discovered relative to the working directory: `plugins` and
  `/abs/path/plugins` are the same directory with two spellings. Plugins are now
  deduplicated by canonical path, so each pack process starts once.
- `gimlet … | head` panicked with a broken-pipe backtrace when the reader
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

- **Core** (`gimlet-eye-core`): `Tool` / `ToolManifest` / `Report` contracts,
  registry with built-in precedence and fuzzy suggestions, versioned TOML config
  with module namespaces, JSONL audit trail that records argument names only,
  capability model, JSON-RPC plugin host with timeouts and per-pack failure
  isolation.
- **Sysadmin** (`gimlet-eye-sysadmin`): native `system-info` and `disk-usage`
  ports of the Perl Den modules, with pure `/proc` and `df` parsers and
  configurable thresholds.
- **Crypto** (`gimlet-eye-crypto`): `CryptoBackend` seam, OS CSPRNG backend,
  `passgen` (unbiased sampling, guaranteed character classes, entropy estimate)
  and `sha256`.
- **Privacy** (`gimlet-eye-scrub`): metadata scan, strip, and verify for JPEG,
  PNG, and WebP — byte-preserving, verified before write, `--dry-run` aware.
- **Surfaces**: `gimlet` CLI (`run`, `tools`, `plugins`, `config`, `audit`,
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
