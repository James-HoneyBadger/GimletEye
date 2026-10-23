# Enhancements and feature proposals

A prioritized backlog beyond [ROADMAP.md](ROADMAP.md). Each item states the
problem, why it matters, and a rough effort so it can be argued with rather than
guessed at.

Effort: **S** ≤ 1 day · **M** ≤ 1 week · **L** > 1 week.
Risk is about user-visible damage if the work goes wrong, not difficulty.

---

## The next five

These are ordered by value per unit of risk. Everything else can wait.

| # | Item | Why now | Effort | Risk |
|---|---|---|---|---|
| 1 | [Complete the crypto pillar](#1-complete-the-crypto-pillar) | Encryption and signatures shipped; streaming, keystore, and key exchange remain. | L | High |
| 2 | [hb-scrub pack for the other ten formats](#2-hb-scrub-pack-for-the-remaining-ten-formats) | Ten formats of parity for a manifest and a small adapter. | S–M | Low |
| 3 | [Batch execution](#3-batch-execution) | Privacy work is per-file today; real use is per-directory. | M | Medium |
| 4 | [Golden corpus and fuzzing](#4-golden-corpus-and-fuzzing) | A tool that deletes bytes needs evidence, not confidence. | M | Low |
| 5 | [Pack trust and conformance](#5-pack-trust-and-conformance) | Packs are the extension story; they need a safety story. | M | Medium |

---

## Privacy and metadata

### 1. Complete the crypto pillar

**Problem.** `crates/crypto` defines `CryptoBackend`; only `OsBackend` implements
it. AEAD, signatures, HBZF, and the keystore are unavailable.

**Done.** Authenticated encryption (AES-256-GCM, ChaCha20-Poly1305), Argon2id
key derivation, Ed25519 signing, and the `.melv` container are implemented and
covered by known-answer tests.

**Remaining.**
1. **Streaming container v2** — chunked framing with a per-chunk counter, so a
   10 GB file does not need 10 GB of RAM. v1 files must keep opening.
2. **Keystore** — encrypted key storage, listing, rotation, and expiry checks.
   Today keys are plain files with mode 0600.
3. **Key exchange** — X25519 recipients and RSA, then OpenPGP interop so the
   tool can talk to existing GPG users.
4. **Shamir split/combine and secure shred**, with `--dry-run` by default.

**Effort** L · **Risk** High — a container or key-format regression here is
unrecoverable data loss. Every change needs a golden-file test and an ADR.

### 2. hb-scrub pack for the remaining ten formats

**Problem.** Native support covers JPEG, PNG, WebP. HEIC, AVIF, TIFF, PDF, MP4,
RAW, GIF, and SVG return `unsupported`.

**Why.** The TypeScript implementation already exists and is tested. A pack
adapter buys parity immediately and keeps the roadmap honest while native ports
land one at a time.

**Shape.** `plugins/hb-scrub-pack/` with a Node adapter that maps
`readMetadata`/`removeMetadata`/`verifyClean` onto the report contract. Each
format ported natively later simply shadows the pack.

**Effort** S–M · **Risk** Low — the implementation is unchanged; only the
transport is new.

### 3. Batch execution

**Problem.** `privacy.metadata-strip` takes one `input`. Cleaning a directory
means a shell loop, which loses the aggregate result and the audit trail.

**Why.** The first thing anyone does with a metadata tool is point it at
`~/Pictures`.

**Shape.** A generic `mellivora batch` that expands paths/directories, runs a
tool per file with `input=` bound, honours a concurrency limit and `--fail-fast`,
and emits one aggregate report plus per-file reports. Belongs in the CLI, not the
privacy module, because every tool benefits.

**Effort** M · **Risk** Medium — a failed item must not abort the batch silently.

### 4. Golden corpus and fuzzing

**Problem.** Parser tests use hand-built fixtures. Hand-built fixtures encode the
author's assumptions — including wrong ones (a test in this repo initially
asserted the wrong sign for a West longitude).

**Why.** A metadata stripper that silently corrupts a file is worse than no tool.
The corpus and fuzzers are the only real safety net.

**Shape.**
- `crates/scrub/tests/golden/` with license-clean images (one per format, plus
  malformed samples), each with an expected `scan` decision list and the SHA-256
  of the expected stripped output.
- `cargo-fuzz` targets for the JPEG/PNG/WebP/EXIF parsers.
- Property tests: `scan(strip(x))` has zero removable bytes; `strip` never grows
  the file; `strip` is idempotent; redaction is idempotent (already unit-tested).

**Effort** M · **Risk** Low.

### 5. Pack trust and conformance

**Problem.** A pack is an arbitrary executable. Today trust means "you put it in
the directory". Packs can also declare capabilities they do not use.

**Why.** As soon as packs are distributed, "just don't install bad ones" stops
being an answer.

**Shape.**
- `mellivora plugins conformance <dir>` runs the SDK checklist automatically
  (handshake, ids unique, findings drive status, dry-run honoured, clean exit).
- Manifest `[trust] sha256 = "..."` pinning the entry point, verified before
  spawn; warn on mismatch, refuse when `plugins.require_signature = true`.
- Report the declared capabilities in `plugins list` and surface a diff between
  declared and observed (exec, network) once the host can observe it.

**Effort** M · **Risk** Medium — a false "untrusted" blocks legitimate packs.

### Other privacy items

| Item | Why | Effort |
|---|---|---|
| `privacy.stego-scan` | Detects hidden payloads behind an image; cheap, distinctive, and fits the module. | S |
| Metadata injection | Writing a clean copyright/software/artist field is the counterpart to stripping. Needs the TIFF writer; risky. | M |
| Field-level decision report | Emit `decisions: [{segment, action, reason}]` so a compliance reviewer can see *why* each byte was kept or removed. | S |
| Streaming strip | Multi-GB video and RAW currently load fully into memory. | M |
| GPS redaction for RAW/HEIC/TIFF | Only JPEG/PNG/WebP today. | S–M each |
| Profile file | `--policy policies/redact.toml` for a shared, reviewable policy instead of ad-hoc flags. | S |
| Archives | A zip/tar of photos carries metadata inside; currently out of scope and easy to miss. | M |

### 6. ADR for profile semantics

**Problem.** `privacy`, `sharing`, and `archive` were defined here: privacy
removes identity/text/time, sharing keeps time, archive keeps all. That is a
reasonable design but it is currently only documented in code.

**Why.** Users will build CI on these semantics. Write them down before v1.0.

**Effort** S · **Risk** Low.

---

## Crypto

| Item | Why | Effort |
|---|---|---|
| `crypto.pass-audit` | Password *generation* exists; auditing an existing one does not. Offline strength + pattern checks, no network calls. | S |
| `crypto.key-audit` | Expired, weak, or duplicated keys in a keystore. Pairs naturally with `sysadmin` audits. | M |
| Shamir split/combine | Secret sharing is a natural companion to key management, and a small wrapper. | S |
| Secure shred | Deletion that survives forensic recovery. Must be `--dry-run` first and require explicit confirmation. | S |
| QR export/import | Out-of-band key exchange without a network. Needs a terminal renderer plus UI support. | M |
| OpenPGP interop tools | Sequoia integration exists; `crypto.gpg-*` tools make migration from existing GPG users practical. | M |
| Post-quantum readiness | Track ML-KEM/ML-DSA support in the RustCrypto ecosystem; do not implement primitives. | S now, L later |

---

## Sysadmin and automation

| Item | Why | Effort |
|---|---|---|
| Port `FailedLoginDetector`, `FilePermissions`, `UserAudit` | Security-relevant, read-only, and currently only available through the Perl pack. | M |
| `automation` module (scheduled runs) | Perl Den's crontab scheduler is not ported. Prefer systemd timers on Linux, cron as fallback, `--dry-run` default. | L |
| `sysadmin.config-drift` | Perl Den's `ConfigDiff` is the cheapest way to add real value: snapshot, diff, report drift as findings. | M |
| Fixture-driven ports of the remaining modules | Keeps behaviour honest as they move out of the pack. | M |
| Explicit platform contract | Several tools read `/proc` and shell out to `df`. State "Linux" in the manifest and degrade cleanly elsewhere. | S |

---

## Platform and surfaces

| Item | Why | Effort |
|---|---|---|
| WASM target | Metadata scan/strip, hashing, and password generation all work on `&[u8]` and would run in a browser with no upload. High privacy value. | M |
| Embed the server in the Tauri process | The desktop app currently needs a second process; embed it and ship one binary. | S |
| API authentication | Loopback-only today. A bearer token plus a bind guard is the minimum before any remote use. | S |
| TUI | A terminal browser makes the toolkit usable over SSH, which is where sysadmin work happens. | M |
| Shell completions + man pages | `clap_complete` and `clap_mangen`; near-zero cost, real ergonomics. | S |
| `--output <file>` and `--quiet` | CI wants a report artifact, not stdout parsing. | S |
| Structured logging / OpenTelemetry spans | Turns "why was that slow" into a query. Packs are already timed per request. | M |

---

## Developer experience and quality

| Item | Why | Effort |
|---|---|---|
| MSRV CI job | `rust-version` is declared but never enforced. | S |
| Conformance tests in CI for packs | The Perl pack is exercised; a general harness keeps the SDK honest. | M |
| Benchmarks for large files | Catches accidental quadratic behaviour in scan/strip. | S |
| Docs site | Markdown is fine now; linked HTML with search pays off past ~10 documents. | M |
| Reproducible release artifacts | Signed binaries, SBOM, and `cargo auditable` metadata. | M |

---

## Explicitly not doing

- **An IDE.** Mellivora is a workbench, not an editor. Editors stay editors.
- **A hosted service.** Everything is local; a cloud mode would undo the privacy
  guarantee that makes the toolkit worth using.
- **Custom cryptographic primitives.** Wrap audited implementations; never
  implement AES, signatures, or KDFs here.

---

## How to propose something

Open an issue with: the tool id, the user problem, the smallest acceptable
behaviour, and what it must never do. Items that change a `Report` field, the
plugin protocol, or on-disk format need an ADR first.
