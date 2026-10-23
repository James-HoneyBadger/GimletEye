# The `.melv` container

The format written by `crypto.encrypt` and read by `crypto.decrypt`. It exists to
be small, self-describing, and impossible to tamper with silently.

Extension: `.melv` · Magic: `MELV` · Version: 1

## Layout

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | magic `MELV` |
| 4 | 1 | format version (`1`) |
| 5 | 1 | cipher id (`1` = AES-256-GCM, `2` = ChaCha20-Poly1305) |
| 6 | 1 | KDF id (`1` = Argon2id) |
| 7 | 1 | reserved, must be `0` |
| 8 | 4 | Argon2id memory cost, KiB, little-endian |
| 12 | 4 | Argon2id time cost, little-endian |
| 16 | 1 | Argon2id parallelism |
| 17 | 4 | reserved, must be `0` |
| 21 | 16 | salt |
| 37 | 12 | nonce |
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

## Limitations (v1)

- **Whole file in memory.** There is no streaming mode yet; a multi-gigabyte
  file is read entirely. A streaming v2 would keep this header and add chunked
  framing with a per-chunk counter.
- **Passphrase only.** There are no public-key recipients and no key wrapping.
- **No embedded metadata.** Filenames, sizes, and timestamps are *not* stored;
  the container is opaque by design.
- **No compression.** Compression before encryption changes length; do it
  yourself if needed.

## Versioning

Version 1 is the first published format. Any change to the layout, the meaning
of a field, or the derivation inputs requires:

1. a new version byte,
2. an ADR,
3. a compatibility test that still decrypts v1 files,
4. an entry in [COMPATIBILITY.md](COMPATIBILITY.md).
