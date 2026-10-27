# 0010 — Retire Rust

- **Status:** Proposed
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
| 3 | metadata scrub (JPEG/PNG/WebP/XMP) | the golden corpus, including pixel-identity of what is kept |
| 4 | tool wiring, then delete `crates/`, the Cargo manifests, the MSRV and fuzz jobs, and both `deny.toml` files | `make check` green with no Rust toolchain installed |

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
- The fuzz corpus can be kept and replayed through the TypeScript parsers.

**Negative**

- **The fuzzing and MSRV evidence is lost until it is rebuilt.** `cargo fuzz`
  found the expensive-header denial of service that is now a documented bound;
  a TypeScript parser has no equivalent overnight. Stage 3 must add property
  tests and keep the corpus as fixtures, and the 1.0 gate should say so.
- Rust's compile-time guarantees around buffer handling become review and tests.
  This is a real reduction in assurance, not a wash.
- Argon2id becomes a dependency instead of a crate: `@noble/hashes` is audited,
  but it is still a dependency in the trust boundary where there was none.
- Streaming stays bounded only if the TypeScript reader keeps the chunk-at-a-time
  discipline; nothing in the type system enforces it.

## Rejected alternatives

- **Keep Rust and delete the summary's other half.** Rejected by the owner's
  instruction: no Rust anywhere.
- **Rewrite the engine in C or Go.** Moves the build problem rather than solving
  it, and adds a second toolchain again.
- **Delete Rust now and ship the unported tools broken.** Rejected: `crypto.*`
  and `privacy.metadata-*` are the product. Stages 2–4 exist so that nothing is
  deleted before its replacement passes.
