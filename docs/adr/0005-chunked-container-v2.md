# ADR 0005: chunked container version 2

**Status:** Accepted · 2026-10-24

## Context

Version 1 of the `.gimlet` container encrypts the whole file as one AEAD message.
That is the simplest correct thing, and it is why v1 could be specified in a
page. It also means memory grows with the input: a 2 GiB file costs roughly
4 GiB at peak (plaintext, ciphertext, and the AEAD output), and a 10 GiB file
cannot be encrypted on an ordinary machine at all.

The roadmap's acceptance criterion for this work was "bounded memory on a 10 GB
input; v1 files still open". Neither half is optional: the container is public
API, and [COMPATIBILITY.md](../COMPATIBILITY.md) promises that v1 files always
open.

## Decision

Keep the 49-byte header and add a chunk stream after it, selected by the version
byte (2). Each chunk is `flags | u32le ciphertext length | ciphertext`, with at
most 64 KiB of plaintext per chunk. Chunk *i* uses the header's base nonce with
the counter XORed into its low 8 bytes, and authenticates the header, its index,
and its final flag as associated data.

`crypto.encrypt` writes version 2. `crypto.decrypt` and `crypto.inspect` read
both versions. The v1 in-memory writer stays in the crate because it is what
produces compatibility fixtures.

## Why this shape

**A version byte rather than new fields.** The header layout, KDF derivation,
and cipher identifiers are untouched, so version 2 is a framing change, not a
second format. One parser handles both; the version check is the only branch.

**Position and finality inside the AEAD.** Putting the chunk index and the final
flag in the associated data makes reordering, truncation, splicing, and trailing
data *authentication* failures rather than length checks that a careful attacker
might satisfy. It costs 9 bytes per chunk and one branch per chunk.

**One lookahead chunk.** Knowing a chunk is final before encrypting it requires
seeing what follows. Two 64 KiB buffers, swapped as the stream advances, avoid
either a terminator chunk or seeking — and keep memory constant regardless of
input size.

**A random base nonce with a counter.** Reusing a nonce under one key is
catastrophic for both ciphers. A random base per file plus a counter that never
repeats within that file gives distinct nonces with no coordination, and the
salt already differs per file so keys differ too.

## Costs

- **Framing overhead** of 5 bytes plus one 16-byte tag per 64 KiB: 0.03% at the
  default chunk size.
- **Random access is still impossible.** Chunks are sequential; seeking into a
  large container requires decrypting from the start. That is unchanged from v1
  and is the next thing to fix if it matters.
- **Old builds cannot read new files.** A 0.2.x binary refuses v2 with
  `container format version 2 is not supported` rather than misreading it. That
  is the forward-compatibility rule working as intended, and it is why the
  release notes say to upgrade.
- **Two code paths in the reader.** Accepted: the v1 path is a dozen lines and
  is pinned by a fixture written by 0.2.0.

## Verification

- Chunk-boundary round trips at 0, 1, 64 KiB − 1, 64 KiB, 64 KiB + 1, and
  3 × 64 KiB, for both ciphers.
- Truncation (mid-chunk and boundary), trailing bytes, chunk reordering, a
  flipped final flag, and a wrong passphrase all fail.
- A 4 MiB stream through a 997-byte reader round-trips, so the code does not
  depend on read sizes.
- `crates/crypto/tests/fixtures/container-v1.melv` — a real artifact from the
  0.2.0 release — opens, with a test asserting the fixture is still v1 so it
  cannot be silently regenerated.
- Measured peak RSS on a 4-core aarch64 host: 22.7 MiB for both 512 MiB and
  2 GiB inputs (v1: 1539.5 MiB for 512 MiB).
