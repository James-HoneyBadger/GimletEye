# The `.melv` container

The format written by `crypto.encrypt` and read by `crypto.decrypt`. It exists to
be small, self-describing, and impossible to tamper with silently.

Extension: `.melv` · Magic: `MELV` · Versions: 1 (whole file) and 2 (chunked)

## Layout

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | magic `MELV` |
| 4 | 1 | format version (`1` = whole file, `2` = chunked) |
| 5 | 1 | cipher id (`1` = AES-256-GCM, `2` = ChaCha20-Poly1305) |
| 6 | 1 | KDF id (`1` = Argon2id) |
| 7 | 1 | reserved, must be `0` |
| 8 | 4 | Argon2id memory cost, KiB, little-endian |
| 12 | 4 | Argon2id time cost, little-endian |
| 16 | 1 | Argon2id parallelism |
| 17 | 4 | reserved, must be `0` |
| 21 | 16 | salt |
| 37 | 12 | nonce (version 2: the base nonce for chunk 0) |
| 49 | … | ciphertext, including the authentication tag |

The first 49 bytes are the **header**. Everything after offset 49 is
ciphertext.

## Why the header is authenticated

The whole header is passed to the AEAD as associated data. That means:

- Changing the cipher id, the KDF parameters, or the salt makes decryption
  **fail** rather than succeed with a weaker configuration.
- There is no unauthenticated field to abuse — including the fields a reader
  needs before it can decrypt anything.

The reader still validates parameter bounds *before* key derivation, so a
crafted header cannot demand gigabytes of memory. Accepted range: 8 KiB –
1 GiB memory, 1–16 iterations, 1–8 lanes.

## Reserved bytes

Reserved fields must be zero. A non-zero value means the file uses a feature
this build does not understand, and the reader refuses rather than ignoring it.
That is the forward-compatibility rule: new capabilities get a new **version
byte**, never an overloaded reserved field.

## Key derivation

Argon2id, version `0x13`, 32-byte output, with the parameters stored in the
header. Defaults follow OWASP guidance: 19 MiB, two iterations, one lane.

The passphrase is never written anywhere. It is read from an environment
variable (`passphrase_env`) by preference, because inline arguments land in
shell history and process listings.

## Nonces

A fresh 12-byte nonce and a fresh 16-byte salt are generated from the OS CSPRNG
for every file. With a random 96-bit nonce, the probability of a repeat under a
single key is negligible for any realistic number of files; the salt also
differs per file, so the derived key differs even for the same passphrase.

Nonce reuse is catastrophic for GCM and ChaCha20-Poly1305, so the API requires
callers to supply a nonce explicitly and the container layer is the only thing
that generates one.

## Failure modes

A wrong passphrase and a corrupted ciphertext produce the same error, on
purpose: distinguishing them would turn the tool into an oracle. The message
names both possibilities and never echoes key material.

A file that is modified in transit fails at the tag check. A file whose header
is modified fails the same way. There is no partial decrypt: the plaintext is
only written after the tag verifies.

## Version 2: chunked framing

Version 1 puts the whole file in one AEAD message, so encrypting a 2 GiB file
costs about 4 GiB of memory. Version 2 keeps the same 49-byte header and adds a
chunk stream after it. `crypto.encrypt` writes version 2; `crypto.decrypt`
reads both.

Each chunk is framed as:

| Bytes | Field |
|---|---|
| 1 | flags: bit 0 set on the final chunk, all others zero |
| 4 | ciphertext length, little-endian |
| *n* | ciphertext, including its 16-byte tag |

The plaintext chunk is at most 64 KiB, so a frame is at most 65 552 bytes. A
reader refuses a length outside `16..=65552`, so a crafted frame cannot ask for
an arbitrary allocation.

**Per-chunk nonce.** Chunk *i* uses the header's base nonce with the counter
`i` XORed into its low 8 bytes. The base nonce is random per file and the
counter never repeats, so no nonce is ever reused under a key.

**Per-chunk associated data.** Each chunk authenticates the header, its own
index, and its final flag:

```
aad = header[49] || index (u64le) || flags (1)
```

That single construction buys the properties worth having:

- **Reordering fails.** Moving a chunk changes its index, so its tag no longer
  verifies.
- **Truncation fails.** A reader that hits EOF where a chunk header belongs
  reports `container is truncated`, and a stream whose last chunk is not
  flagged final cannot verify.
- **Splicing fails.** Chunks from another file carry a different header.
- **Trailing data fails.** Bytes after the final chunk are rejected rather than
  ignored.

`privacy`-style partial output is impossible: the tool writes to a sibling
temporary file and renames it only after the last chunk verifies.

Measured on a 4-core aarch64 machine, peak RSS is flat as input grows:

| Input | Peak RSS | Time |
|---|---|---|
| 512 MiB | 22.7 MiB | 2.0 s |
| 2 GiB | 22.7 MiB | 9.2 s |

The same 512 MiB file under version 1 measured 1539.5 MiB and 5.0 s.

## Limitations (v2)

- **Passphrase only.** There are no public-key recipients and no key wrapping.
- **No embedded metadata.** Filenames, sizes, and timestamps are *not* stored;
  the container is opaque by design.
- **No compression.** Compression before encryption changes length; do it
  yourself if needed.

## Versioning

Version 1 is the first published format; version 2 is the chunked layout above.
A reader accepts both, a version-1 writer is kept for compatibility fixtures,
and version 2 is what tools write. Any further change to the layout, the meaning
of a field, or the derivation inputs requires:

1. a new version byte,
2. an ADR,
3. a compatibility test that still decrypts v1 files,
4. an entry in [COMPATIBILITY.md](COMPATIBILITY.md).
