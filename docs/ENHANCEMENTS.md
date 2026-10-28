# Enhancements and feature proposals

A prioritized backlog beyond [ROADMAP.md](ROADMAP.md). Each item states the
problem, why it matters, and a rough effort so it can be argued with rather than
guessed at.

Effort: **S** ≤ 1 day · **M** ≤ 1 week · **L** > 1 week.
Risk is about user-visible damage if the work goes wrong, not difficulty.

> Items written before [ADR 0010](adr/0010-retire-rust.md) name crates and
> `cargo` commands; the engine is TypeScript now. The proposals are kept because
> the problems are real — read `packages/engine` where they say `crates/`.

---

## The next five

These are ordered by value per unit of risk. Everything else can wait.

| # | Item | Why now | Effort | Risk |
|---|---|---|---|---|
| 1 | [Complete the crypto pillar](#1-complete-the-crypto-pillar) | Encryption and signatures shipped; streaming, keystore, and key exchange remain. | L | High |
| 2 | [Native parsers for the remaining formats](#2-native-parsers-for-the-remaining-formats) | Format parity is a parser each; there is no pack to borrow one from any more. | L | Medium |
| 3 | [Golden corpus and fuzzing](#3-golden-corpus-and-fuzzing) | A tool that deletes bytes needs evidence, not confidence. | M | Low |
| 4 | [Observe declared capabilities](#4-observe-declared-capabilities) | The declaration is the security story; nothing checks the code against it. | M | Low |
| 5 | [Scheduled runs](#5-scheduled-runs) | The engine can repeat work per file; the next ask is per hour. | M | Medium |
| 5 | [Scheduled runs](#5-scheduled-runs) | The engine can repeat work per file; the next ask is per hour. | M | Medium |

Shipped since this list was written: **batch execution** (`gimlet batch`,
below), **manifest `mutates`**, a **UI test suite**, the **TUI**
(`gimlet tui`), **shell completions and a man page** (`gimlet completions`,
`gimlet man`), the **five audits** (`sysadmin.file-permissions`,
`sysadmin.user-audit`, `sysadmin.failed-login-detector`,
`sysadmin.config-drift`, `crypto.pass-audit`), and `--output`/`--quiet`. The HTTP
API, its bearer token, and the pack protocol were **removed** at 0.8, so the
items below that lean on packs describe a mechanism this tree no longer has.

---

## Privacy and metadata

### 1. Complete the crypto pillar

**Problem.** `crates/crypto` defines `CryptoBackend`; only `OsBackend` implements
it. AEAD, signatures, HBZF, and the keystore are unavailable.

**Done.** Authenticated encryption (AES-256-GCM, ChaCha20-Poly1305), Argon2id
key derivation, Ed25519 signing, and the `.gimlet` container are implemented and
covered by known-answer tests.

**Done since:** streaming container v2 (chunked framing, bounded memory, v1
files still open — see [ADR 0005](adr/0005-chunked-container-v2.md)); the sealed
keystore, X25519 recipients in container v3, and OpenPGP interop through the
system `gpg` (see [ADR 0007](adr/0007-keystore-and-recipients.md)).

**Remaining.** Each of these touches `keystore.ts` or `keys.ts`, which the 1.0
quiet period freezes until after 1.1 — landing one now would restart the
countdown, so they are planned rather than pending:
1. **Key expiry and audit** — the keystore lists and rotates, but nothing tracks
   an expiry date or reports a weak or duplicated key. (`crypto.pass-audit`
   covers the password half of this; the key half does not ship until 1.1.)
2. **RSA recipients** — X25519 covers the modern case; RSA is for talking to
   older tooling, and survives review only if it earns its weight.
3. **Shamir split/combine and secure shred**, with `--dry-run` by default.
   Shred is host-only and could land sooner; secret sharing needs `keys.ts`.

**Effort** L · **Risk** High — a container or key-format regression here is
unrecoverable data loss. Every change needs a golden-file test and an ADR.

### 2. Native parsers for the remaining formats

**Problem.** Native support covers JPEG, PNG, and WebP. HEIC, AVIF, TIFF, PDF,
MP4, RAW, GIF, and SVG all return `unsupported`.

**Why.** The earlier plan was a pack over an existing TypeScript library; the
plugin protocol was removed at 0.8, so parity now means writing the parser here,
next to the corpus and the fixtures, which is where the other three live. This
is the largest open item and the one most likely to want an ADR.

**Shape.** One module per format in `packages/engine/src/scrub`, each with a
fixture and a `scan`/`strip`/`verify` triple, plus a manifest entry. A format
whose parser would need a native dependency waits for a decision rather than
arriving as one.

**Effort** L · **Risk** Medium — a wrong parser silently corrupts bytes, which is
why the corpus requirement below comes with it.

### 3. Golden corpus and fuzzing

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

### 4. Observe declared capabilities

**Problem.** Every manifest declares capabilities (`fs:write`, `process:exec`,
`network`, `secrets`), and a test can check that the set is drawn from a known
list — but nothing checks that a tool *uses* only what it declared. The pack
machinery that would have answered this was removed at 0.8; the question
survives it.

**Why.** The declaration is the security story for the desktop shell and for a
future scheduler: a tool that writes files without saying so is the one that
matters.

**Shape.** A test harness that runs each tool against the fake host and records
which operations it touched, compared with its declaration. `network` already has
no implementation in `Host`, so the interesting rows are write, exec, and secrets.

**Effort** M · **Risk** Low — a test, not a runtime check.

### 5. Scheduled runs

**Problem.** `gimlet batch` answers "clean this directory once". The next
request is always "do it every night", and today that means cron plus a shell
script that loses the audit trail.

**Why.** An audit trail only helps if the runs that matter are in it.

**Shape.** An `automation` module with `automation.schedule` tools: a job
definition (tool, args, cadence), a dry-run default, and a systemd-timer or
cron backend chosen per platform. The scheduler renders to the host's native
format rather than running its own daemon; the toolkit never stays resident.

**Effort** M · **Risk** Medium — a mis-scheduled mutating job is a data-loss bug,
so dry-run must be the default and the first run must be reported.

### Shipped: batch execution

`gimlet batch <tool> <path>...` expands files and directories, runs the tool
once per file with the path bound to `--input-arg`, and folds the results into
one aggregate report: counts, per-file status and summary, and a finding per
failing file. `--concurrency` bounds parallelism, `--fail-fast` stops after the
first failure (reporting what was skipped), and `--ext` narrows the file set.

It lives in the CLI rather than the privacy module because every tool benefits,
and it emits the same `Report` shape as everything else, so the JSON consumer
needs no special case.

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

### Markdown table escaping (deferred past 1.0)

**Problem.** `Report::render_markdown` interpolates finding messages and targets
into a table without escaping. A filename may legally contain `|`, and a pack may
put a newline in its own text; either ends the row and shifts every column after
it, so `--format markdown` renders as noise exactly when someone is pasting a
report into an issue. CSV is already correct — it quotes commas, quotes, and
newlines.

**Why deferred.** The fix is two lines in `crates/core/src/report.rs`, which the
quiet-period check lists as a frozen surface, and `ALLOW_SURFACE_CHANGE` restarts
the two-release counter — a rendering fix is not worth restarting a freeze that
is one soak away from 1.0. The patch exists in history as commit `caeacb9` on
2026-10-26; re-apply it in the first 1.x minor.

**Effort** S · **Risk** Low.

---

### ADR for profile semantics

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
| `crypto.key-audit` | Expired, weak, or duplicated keys in the keystore that 0.5 introduced. Pairs naturally with `sysadmin` audits. | M |
| Shamir split/combine | Secret sharing is a natural companion to key management, and a small wrapper. | S |
| Secure shred | Deletion that survives forensic recovery. Must be `--dry-run` first and require explicit confirmation. | S |
| QR export/import | Out-of-band key exchange without a network. Needs a terminal renderer plus UI support. | M |
| ~~OpenPGP interop tools~~ | **Done in 0.5** as `crypto.gpg-verify`/`crypto.gpg-encrypt` driving the system `gpg`; a Sequoia-backed implementation would remove the external dependency. | M |
| Post-quantum readiness | Track ML-KEM/ML-DSA support in the RustCrypto ecosystem; do not implement primitives. | S now, L later |

---

## Sysadmin and automation

| Item | Why | Effort |
|---|---|---|
| ~~Port `FailedLoginDetector`, `FilePermissions`, `UserAudit`~~ | **Done in 0.9** as `sysadmin.failed-login-detector`, `sysadmin.file-permissions`, and `sysadmin.user-audit`. | — |
| `automation` module (scheduled runs) | Nothing schedules a job today. Prefer systemd timers on Linux, cron as fallback, `--dry-run` default. | L |
| ~~`sysadmin.config-drift`~~ | **Done in 0.9**: snapshot, diff, report drift as findings. | — |
| Fixture-driven ports of the remaining modules | Keeps behaviour honest as they move out of the pack. | M |
| Explicit platform contract | Several tools read `/proc` and shell out to `df`. State "Linux" in the manifest and degrade cleanly elsewhere. | S |

---

## Platform and surfaces

| Item | Why | Effort |
|---|---|---|
| WASM target | Metadata scan/strip, hashing, and password generation all work on `&[u8]` and would run in a browser with no upload. High privacy value. | M |
| ~~TUI~~ | **Shipped**: `gimlet tui`. | — |
| ~~Shell completions + man pages~~ | **Shipped in 0.9**: `gimlet completions <shell>` and `gimlet man`, generated from `packages/cli/src/surface.ts`. | — |
| ~~`--output <file>` and `--quiet`~~ | **Shipped in 0.9** as global flags, so `batch` and `doctor` honour them too. | — |
| Structured logging / OpenTelemetry spans | Turns "why was that slow" into a query. Packs are already timed per request. | M |

---

## Developer experience and quality

| Item | Why | Effort |
|---|---|---|
| ~~MSRV CI job~~ | gone with the Rust; the Node floor is `engines.node` and `setup-node`. | — |
| ~~End-to-end UI tests against a live engine~~ | **Shipped**: the `e2e` job drives the real window with Playwright. | — |
| ~~Benchmarks for large files~~ | **Shipped in 0.9**: `make bench` (`scripts/bench.mjs`) with floors for hashing, the container, and the scrub. | — |
| ~~Reproducible release artifacts~~ | **Shipped**: the `reproducible` job rebuilds and compares, and `SHA256SUMS` is signed. | — |
| An SBOM over the npm tree | Signed artifacts and checksums exist; a bill of materials does not. | M |
| Docs site | Markdown is fine now; linked HTML with search pays off past ~10 documents. | M |

---

## Explicitly not doing

- **An IDE.** Gimlet Eye is a workbench, not an editor. Editors stay editors.
- **A hosted service.** Everything is local; a cloud mode would undo the privacy
  guarantee that makes the toolkit worth using.
- **Custom cryptographic primitives.** Wrap audited implementations; never
  implement AES, signatures, or KDFs here.

---

## How to propose something

Open an issue with: the tool id, the user problem, the smallest acceptable
behaviour, and what it must never do. Items that change a `Report` field, the
CLI surface, or the on-disk format need an ADR first.
