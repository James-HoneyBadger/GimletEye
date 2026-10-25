# ADR 0007: keystore, X25519 recipients, and container version 3

**Status:** Accepted · 2026-10-25

## Context

[ADR 0006](0006-what-1.0-promises.md) makes two things Gate 1 requirements rather
than nice-to-haves: a keystore that survives restart, and key exchange with
recipients. Both are surface commitments, and 0.5 is the last minor release
allowed to make them.

What exists today:

- `crypto.keygen` writes an Ed25519 secret key as a **plain file** with mode
  0600. It is protected by the filesystem and nothing else: a backup, a synced
  folder, or a `cp` to `/tmp` takes the secret with it, and there is no way to
  hold more than a handful of keys without managing files by hand.
- `crypto.encrypt` needs a passphrase **shared out of band**. Two parties must
  invent a channel for it, or reuse one that has been in a chat history for
  years. That is the single biggest thing standing between this toolkit and a
  use case a cryptographer would defend.
- `crypto.sign` / `crypto.verify` already do public-key signatures, so a keypair
  is a concept the toolkit has; it just has nowhere to live.

The question this ADR answers: what does the keystore store, how is it sealed,
and what does a file encrypted *for a recipient* look like on disk?

## Decision 1 — the keystore is one sealed container

`$MELLIVORA_HOME/keystore.melv` holds a JSON document sealed with the container
format that already exists (Argon2id → AEAD, chunked framing). Mode 0600, written
through a temporary file and renamed into place, like every other write this
toolkit makes.

```json
{
  "schema_version": 1,
  "entries": [
    {
      "id": "3f9a1c07b2d84e51",
      "label": "work signing key",
      "kind": "ed25519",
      "public_key": "…64 hex…",
      "secret_key": "…64 hex…",
      "created_at": "2026-10-25T21:00:00Z"
    }
  ]
}
```

`kind` is `ed25519` (signing) or `x25519` (encryption recipients). The id is 8
random bytes; it exists so a key can be named in a command without a path.

Rejected alternatives:

| Alternative | Why not |
|---|---|
| A key per file (today's `keys.rs`) | Every file repeats the KDF parameters and salt, a set of keys cannot be replaced atomically, and "rotate the passphrase" becomes N re-encryptions |
| A new bespoke keystore format | A second format to specify, fuzz, and keep compatible forever, for content that is 200 bytes of JSON |
| SQLite or `keyring` | A dependency and a second consistency model — and `keyring` silently makes the keystore unopenable on a machine without the desktop session bus |
| Encrypt each entry with its own key | Nothing to gain until there is a second way to unlock (hardware token, second recipient). The container tag already fails closed on the wrong passphrase |

**Wrapping** at this layer *is* the container's AEAD: one Argon2id-derived key
seals every entry in the file, so a wrong passphrase fails the tag before JSON is
ever parsed. A two-level scheme (master key wrapping per-entry keys) is
deliberately deferred: it only pays off once a second unlock path exists, and it
is additive when it does.

**Rotation** re-seals the document under a new passphrase with fresh Argon2id
parameters and a fresh salt. Key material is not regenerated — that would break
every signature the user has already published — so `crypto.key-rotate` rotates
the *seal*, and says so in its summary. Rotating a key's material is
`crypto.key-export` + `crypto.key-import` under a new label, which is explicit.

## Decision 2 — container version 3 carries recipients

Version 3 is chosen when the caller names recipients (`--to`), and only then.
Versions 1 and 2 keep opening exactly as they do today; v3 adds no new field to
them and does not touch their code paths.

```text
0..4    magic "MELV"
4       format version (3)
5       cipher id      (1 = AES-256-GCM, 2 = ChaCha20-Poly1305)
6       kdf id         (3 = x25519-hkdf-sha256)
7       reserved (0)
8..40   ephemeral X25519 public key (32)   -- one per file, shared by recipients
40..44  recipient count (u32le)
44..    recipients, count × 92 bytes:
          44..76   recipient public key (32)  -- so a reader finds its own entry
          76..88   wrap nonce (12)
          88..136  wrapped file key (32 + 16 tag)
...     chunk stream, byte-for-byte the version 2 framing
```

For each recipient:

```text
shared  = DH(ephemeral_secret, recipient_public)          // X25519
kek     = HKDF-SHA256(ikm = shared, salt = ephemeral_public,
                      info = "melv-v3-recipient" || recipient_public)
wrapped = AEAD(kek, wrap_nonce, file_key, aad = header[0..44] || recipient_public)
```

The payload is encrypted with a random 32-byte **file key** — the same key type
the passphrase path derives — so the chunk stream, its nonce derivation, and its
associated data are unchanged from version 2. Only the header grew, and the
header is authenticated as AAD for every chunk, so moving a recipient block or
flipping a cipher id breaks the payload rather than silently re-addressing the
file.

**A recipient is found by public key, not by trial decryption.** Any entry for
which the reader has no secret key is simply not theirs; the reader compares the
public part of its key against the block and either finds its entry or reports
"this file is not encrypted for that key".

Rejected alternatives:

| Alternative | Why not |
|---|---|
| One ephemeral keypair per recipient | A larger header, and nothing gained: the ephemeral secret is discarded either way |
| Wrap the file key without per-recipient AAD | A block could be copied from another file, or two recipients swapped, and the file would still open |
| Derive the payload key straight from the DH secret | Then every file to the same recipient reuses a key unless a salt is introduced anyway; a random file key is simpler to reason about and keeps the chunk layer identical to v2 |
| Make v2 carry recipients in reserved bytes | v2 files exist; changing what its reserved bytes mean is exactly the compatibility break the version byte is for |

## Decision 3 — OpenPGP is a shell-out, and it stays one

`crypto.gpg-verify` and `crypto.gpg-encrypt` drive the system `gpg`, like
`sysadmin.disk-usage` drives `df`. They declare the capability `external:gpg`,
fail with a clear message when `gpg` is absent, and pass paths as separate
arguments (never through a shell). The purpose is a migration path for people who
already have GPG keys, not a second implementation of OpenPGP: writing one would
be months of work and a large new parser to fuzz, which is the opposite of what
Gate 1 asks for.

They are behind the `openpgp` Cargo feature, **on by default** so the shipped
build and the tests agree. A build without it (`--no-default-features`) has no
`crypto.gpg-*` tools and no way to be surprised by a subprocess.

## Decision 4 — format coverage is advertised per pack, not promised globally

The `hb-scrub` pack (HEIC/AVIF/TIFF/PDF/MP4/RAW/GIF/SVG) is **not** in 0.5. Its
acceptance criterion is "each advertised format round-trips", and the formats it
would advertise cannot be verified on a machine without `exiftool`; shipping a
pack whose claims CI cannot check is precisely the overstatement ADR 0006 says to
avoid. The README keeps saying "packs, then native" — a plan, not a capability —
and the pack moves behind 1.0, where it is additive and cannot affect a freeze.

## New dependencies

Both are RustCrypto/Apache-2.0-or-MIT and both are covered by `deny.toml`:

| Crate | Why | Alternative |
|---|---|---|
| `x25519-dalek` | X25519 ECDH, constant-time, the same construction `age` uses | `ring` (larger, C/asm, already avoided elsewhere) |
| `hkdf` | HKDF-SHA256 from a DH shared secret | Hand-rolling HKDF-SHA256 on `sha2`; correct but a place to make a subtle mistake |

## Consequences

- A keystore means a passphrase prompt on every use, and a lost passphrase means
  lost keys. The CLI says so on `key-list` and the docs say so louder.
- v3 files can only be opened with a key entry, so a recipient must import one.
  `crypto.key-export` of a *public* key is how that is distributed; exporting a
  secret requires an explicit flag.
- Frozen surfaces grow: `keystore.melv`'s `schema_version` and the v3 header join
  `report.rs`, `protocol.rs`, `config.rs`, and the container constants in the
  quiet-period check. That is the point of doing it now, in the last minor
  allowed to move.
- `crypto.keygen` stays: a single file is still the right shape for a key you
  want to hand to someone or keep offline. It is documented as "unsealed" rather
  than as the recommended storage.
