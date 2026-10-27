# 0010 — Retire Rust

- **Status:** Accepted
- **Date:** 2026-10-27
- **Supersedes:** [0001](0001-rust-spine-with-polyglot-packs.md) in full, and the
  "one Rust engine" half of [0008](0008-typescript-surfaces-rust-engine.md)

## Context

The engine is Rust: `crates/crypto` (5.4k lines), `crates/scrub` (2.9k),
`crates/core` (2.2k), and `crates/sidecar` (164), plus fuzz targets, golden
corpora, an MSRV job, and two `deny.toml` policies. It exists because the crypto
and the format parsers were the part that had to be memory-safe and fast enough
to stream a 2 GiB file at flat memory.

Two things changed. The surfaces are now TypeScript and the engine is the only
Rust left in a checkout that a JavaScript developer otherwise never compiles; and
Node has since grown the primitives the engine actually uses — AES-256-GCM,
ChaCha20-Poly1305, X25519, Ed25519, HKDF, SHA-256 — with Argon2id the single gap,
coverable by an audited pure-JS library.

## Decision

Move the engine to TypeScript, in stages, and delete Rust once the replacement
passes the tests the Rust implementation had to pass. The order is chosen so each
stage is verifiable on its own:

| Stage | Scope | Gate |
|---|---|---|
| 1 ✅ | `.gimlet` container: read v1/v2/v3, write v2/v3 | the committed v1 and v3 fixtures open, byte for byte, and the Python second implementation reads what the new writer emits |
| 2 ✅ | keystore, keys, signing, hashing, passphrase generation | the keystore round-trips owner-only and fails a wrong passphrase at the tag; key files round-trip through the frozen JSON; signing verifies what it signed and nothing else; the passphrase generator guarantees one character per class |
| 3 ✅ | metadata scrub (JPEG/PNG/WebP/XMP) | all six corpus fixtures reproduce the recorded byte length and SHA-256 under all three profiles, and every structural and colour segment survives in order |
| 4 ✅ | tool wiring: all seventeen engine tools run in process, including GPS redaction | every ported tool's report and output bytes match the Rust implementation's on the fixtures both can run |
| 5 ✅ | delete `crates/`, the Cargo manifests, the MSRV and fuzz jobs, and both `deny.toml` files | `make check` green with no Rust toolchain installed |

Stage 4 is being done tool by tool rather than in one switch, so the CLI keeps
working during the migration. `Runtime` registers local tools first and lets the
engine serve whatever is not ported yet. Every engine tool is now ported, GPS
redaction included, and the wiring is compared against the Rust it replaces
rather than assumed: `privacy.metadata-strip` run on every image fixture in the
tree at all three precisions wrote **byte-identical** files from both
implementations, 33 runs and no differences. What remains for stage 5 is
deleting the Rust and making its absence a supported state.

Stage 5 is done. `crates/`, both Cargo manifests, `rust-toolchain.toml`,
`rustfmt.toml`, the two `deny.toml` files, the `rust`/`msrv`/`dependency-policy`
CI jobs, and the fuzz workflow are gone; 75 files. Two things had to be fixed
first, and both were found by running the tree without a toolchain rather than by
reading it:

- `Runtime` opened the sidecar unconditionally, so the CLI could not start
  without an engine even though every tool was built in. It now treats a missing
  engine as a supported state and still refuses one that speaks the wrong
  protocol, because that is a real mismatch rather than an absence.
- `spawnEngine` resolved its transport before the process had spawned, so a
  missing binary surfaced as `the engine exited with status -2` from the first
  request instead of as "there is no engine". It resolves on `spawn` now.

The version has one home (`packages/core/src/version.ts`) because `Cargo.toml`
used to be it; `scripts/check-packaging.sh` checks every `package.json` and every
recipe against that constant. The `dependency policy` job runs `npm audit
--omit=dev` instead of `cargo deny`, and the seed corpus the fuzz targets left
behind is replayed by `packages/engine/test/corpus.test.ts` in its own CI job.

Registration is part of a port, and it is the part that is easy to forget: a
local tool's manifest replaces the engine's for the same id, so a tool that is
written but missing from `NODE_TOOLS` is not merely slower, it silently keeps
running the Rust implementation. Four ports landed that way before
`packages/core/test/node-tools.test.ts` pinned the list to the modules. A port is
therefore only evidence of anything once the CLI output shows the new code
running: `crypto.encrypt` reporting `1 chunk(s)` rather than the engine's `1
chunks` is the check that was actually conclusive.

Stage 1 is in `packages/engine`. The crypto is `node:crypto` (OpenSSL) with
`@noble/hashes` for Argon2id, because Node does not expose it.

## The compatibility contract

Deleting the Rust writer does **not** change the format:

- Every `.gimlet`/`.melv` file written by any released build must keep opening.
  The v1 and v3 fixtures are the standing evidence; they are files written by
  0.2.0 and 0.5.0, not files the current build produced.
- `docs/CONTAINER.md` remains the definition. The Python reader in
  `packages/engine/test/fixtures/read_container.py` stays, because a format that
  only its own source can implement is not documented.
- A version byte, not a reserved field, carries any future capability.

## Consequences

**Positive**

- One toolchain. A contributor needs Node, not a Rust toolchain plus a package
  manager plus a linker for the Tauri shell.
- The engine ships as the same package the surfaces import, so a release stops
  being "a binary plus a Node tree that must find it".
- The fuzz corpus is kept and replayed through the TypeScript parsers; moving it
  into `packages/engine/test/fixtures/corpus` is what let it survive the
  deletion, and `corpus.test.ts` runs it in `npm test`.

**Negative**

- **The fuzzing and MSRV evidence is lost until it is rebuilt.** `cargo fuzz`
  found the expensive-header denial of service that is now a documented bound;
  a TypeScript parser has no equivalent overnight. Stage 3 must add property
  tests and keep the corpus as fixtures, and the 1.0 gate should say so.
- Rust's compile-time guarantees around buffer handling become review and tests.
  This is a real reduction in assurance, not a wash.
- **Secrets cannot be zeroized the way Rust's `zeroize` did it.** A `Buffer` can be
  overwritten after use and is now, but the garbage collector may already have
  copied it and there is no way to prevent that in JavaScript. The mitigation is
  that key material lives in as few places as possible, which is also why the
  desktop keeps the runtime in the main process and out of the webview.
- Argon2id becomes a dependency instead of a crate: `@noble/hashes` is audited,
  but it is still a dependency in the trust boundary where there was none.
- Streaming stays bounded only if the TypeScript reader keeps the chunk-at-a-time
  discipline; nothing in the type system enforces it. It did not, at first: the
  port read and wrote whole files. `crypto.encrypt` and `crypto.decrypt` now go
  through `ChunkSealer`/`ChunkOpener`, and a 256 MiB file peaks at about 106 MiB
  of RSS instead of 909 MiB. A test pins the largest read and write so the
  discipline cannot lapse silently.

## Rejected alternatives

- **Keep Rust and delete the summary's other half.** Rejected by the owner's
  instruction: no Rust anywhere.
- **Rewrite the engine in C or Go.** Moves the build problem rather than solving
  it, and adds a second toolchain again.
- **Delete Rust now and ship the unported tools broken.** Rejected: `crypto.*`
  and `privacy.metadata-*` are the product. Stages 2–4 exist so that nothing is
  deleted before its replacement passes.
