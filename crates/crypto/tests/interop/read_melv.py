#!/usr/bin/env python3
"""A second implementation of the `.melv` container, written from the spec.

ADR 0006 Gate 1 asks that a `.melv` file be "readable by a documented second
implementation", because a format nobody else can implement is a format that is
only documented by its own source. This reader is written against
`docs/CONTAINER.md` alone — it shares no code with the Rust writer — and the test
suite runs it against the committed fixtures, so a change to the spec that the
Rust code quietly ignores shows up as a failure here.

Supported: version 1 (whole-file AEAD), version 2 (chunked), version 3
(X25519 recipients). Passphrase containers take `--passphrase`/`--passphrase-env`;
recipients take `--key-hex`.

Usage:
  read_melv.py FILE [--passphrase-env VAR | --passphrase VALUE | --key-hex HEX] [-o OUT]

Prints the plaintext to stdout, or writes it to `-o`. Reports the header it read
on stderr, so a mismatch is visible rather than silent.
"""

from __future__ import annotations

import argparse
import os
import struct
import sys

MAGIC = b"MELV"
TAG_LEN = 16
NONCE_LEN = 12
HEADER_LEN = 49
SALT_LEN = 16
RECIPIENT_PREFIX_LEN = 44
RECIPIENT_ENTRY_LEN = 92
MAX_RECIPIENTS = 1024
MAX_CHUNK_CIPHERTEXT = 64 * 1024 + TAG_LEN
FLAG_FINAL = 0x01
WRAP_INFO = b"melv-v3-recipient"

AES_256_GCM = 1
CHACHA20_POLY1305 = 2
ARGON2ID = 1
X25519_HKDF_SHA256 = 3


def fail(message: str) -> None:
    sys.stderr.write(f"read_melv: {message}\n")
    raise SystemExit(2)


def derived_key(passphrase: bytes, header: bytes) -> bytes:
    """Argon2id with the parameters from the header, exactly as documented."""
    memory_kib, time_cost = struct.unpack_from("<II", header, 8)
    lanes = header[16]
    salt = header[21 : 21 + SALT_LEN]

    if not 8 <= memory_kib <= 1024 * 1024:
        fail(f"memory cost {memory_kib} KiB is outside the accepted range")
    if not 1 <= time_cost <= 16:
        fail(f"time cost {time_cost} is outside the accepted range")
    if not 1 <= lanes <= 8:
        fail(f"lane count {lanes} is outside the accepted range")

    try:
        from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
    except ImportError:  # cryptography < 44
        from argon2.low_level import Type, hash_secret_raw

        return hash_secret_raw(
            secret=passphrase,
            salt=salt,
            time_cost=time_cost,
            memory_cost=memory_kib,
            parallelism=lanes,
            hash_len=32,
            type=Type.ID,
            version=0x13,
        )

    return Argon2id(
        salt=salt,
        length=32,
        iterations=time_cost,
        lanes=lanes,
        memory_cost=memory_kib,
    ).derive(passphrase)


def aead(cipher_id: int):
    if cipher_id == AES_256_GCM:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        return AESGCM
    if cipher_id == CHACHA20_POLY1305:
        from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305

        return ChaCha20Poly1305
    fail(f"unknown cipher id {cipher_id}")


def chunk_nonce(base: bytes, index: int) -> bytes:
    """The base nonce with the counter XORed into its low 8 bytes."""
    prefix, tail = base[:4], base[4:]
    return prefix + bytes(a ^ b for a, b in zip(tail, index.to_bytes(8, "little")))


def chunk_aad(header: bytes, index: int, flags: int) -> bytes:
    return header + index.to_bytes(8, "little") + bytes([flags])


def open_chunk_stream(cipher, key: bytes, header: bytes, nonce: bytes, body: bytes) -> bytes:
    out = bytearray()
    offset = 0
    index = 0
    final_seen = False
    while True:
        if offset + 5 > len(body):
            if offset == len(body) and not final_seen:
                fail("container is truncated: the last chunk was not flagged final")
            fail("container is truncated: a chunk header is missing")
        flags = body[offset]
        if flags & ~FLAG_FINAL:
            fail(f"chunk {index} has unknown flag bits {flags:#04x}")
        (length,) = struct.unpack_from("<I", body, offset + 1)
        offset += 5
        if not TAG_LEN <= length <= MAX_CHUNK_CIPHERTEXT:
            fail(f"chunk {index} declares an impossible length {length}")
        ciphertext = body[offset : offset + length]
        if len(ciphertext) != length:
            fail(f"chunk {index} is truncated")
        offset += length
        out += cipher(key).decrypt(
            chunk_nonce(nonce, index), ciphertext, chunk_aad(header, index, flags)
        )
        index += 1
        if flags & FLAG_FINAL:
            final_seen = True
            break
    if offset != len(body):
        fail("trailing data after the final chunk")
    return bytes(out)


def unwrap_file_key(cipher, prefix: bytes, secret: bytes) -> tuple[bytes, bytes]:
    """X25519 + HKDF-SHA256, then open the block addressed to our key.

    Returns the file key and the header the chunk stream authenticates: the
    fixed prefix, the recipient blocks, and the base nonce.
    """
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric.x25519 import (
        X25519PrivateKey,
        X25519PublicKey,
    )
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    ephemeral = prefix[8:40]
    (count,) = struct.unpack_from("<I", prefix, 40)
    if not 1 <= count <= MAX_RECIPIENTS:
        fail(f"recipient count {count} is outside the accepted range")

    ours = X25519PrivateKey.from_private_bytes(secret)
    our_public = ours.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    shared = ours.exchange(X25519PublicKey.from_public_bytes(ephemeral))

    for index in range(count):
        start = RECIPIENT_PREFIX_LEN + index * RECIPIENT_ENTRY_LEN
        entry = prefix[start : start + RECIPIENT_ENTRY_LEN]
        recipient, wrap_nonce, wrapped = entry[:32], entry[32:44], entry[44:]
        if recipient != our_public:
            continue
        kek = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=ephemeral,
            info=WRAP_INFO + recipient,
        ).derive(shared)
        file_key = cipher(kek).decrypt(wrap_nonce, wrapped, prefix[:RECIPIENT_PREFIX_LEN] + recipient)
        base_nonce_at = RECIPIENT_PREFIX_LEN + count * RECIPIENT_ENTRY_LEN
        return file_key, prefix[: base_nonce_at + NONCE_LEN]

    fail("this container is not encrypted for that key")


def read_container(blob: bytes, passphrase: bytes | None, secret: bytes | None) -> tuple[bytes, dict]:
    if len(blob) < HEADER_LEN or blob[:4] != MAGIC:
        fail("not a .melv container: bad magic")
    version, cipher_id, kdf_id, reserved = blob[4], blob[5], blob[6], blob[7]
    if reserved != 0:
        fail("reserved byte is not zero: written by a reader-unknown feature")
    cipher = aead(cipher_id)
    summary = {"version": version, "cipher": cipher_id, "kdf": kdf_id}

    if version in (1, 2):
        if kdf_id != ARGON2ID:
            fail(f"version {version} cannot use kdf id {kdf_id}")
        if passphrase is None:
            fail("this container needs a passphrase")
        header = blob[:HEADER_LEN]
        key = derived_key(passphrase, header)
        nonce = header[37:49]
        body = blob[HEADER_LEN:]
        if version == 1:
            if len(body) < TAG_LEN:
                fail("container is truncated: no authentication tag")
            return cipher(key).decrypt(nonce, body, header), summary
        return open_chunk_stream(cipher, key, header, nonce, body), summary

    if version == 3:
        if kdf_id != X25519_HKDF_SHA256:
            fail(f"version 3 cannot use kdf id {kdf_id}")
        if secret is None:
            fail("this container needs a recipient secret key")
        # The whole header, recipients included, is what the chunk stream
        # authenticates, so it has to be read in one piece.
        fixed = blob[:RECIPIENT_PREFIX_LEN]
        (count,) = struct.unpack_from("<I", fixed, 40)
        header_end = RECIPIENT_PREFIX_LEN + count * RECIPIENT_ENTRY_LEN + NONCE_LEN
        if len(blob) < header_end:
            fail("container is truncated: recipient block is incomplete")
        file_key, header = unwrap_file_key(cipher, blob[:header_end], secret)
        base_nonce = header[header_end - NONCE_LEN : header_end]
        summary["recipients"] = count
        return open_chunk_stream(cipher, file_key, header, base_nonce, blob[header_end:]), summary

    fail(f"unknown format version {version}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Read a .melv container without the Rust code.")
    parser.add_argument("file")
    parser.add_argument("--passphrase")
    parser.add_argument("--passphrase-env")
    parser.add_argument("--key-hex")
    parser.add_argument("-o", "--out")
    args = parser.parse_args()

    passphrase = None
    if args.passphrase is not None:
        passphrase = args.passphrase.encode()
    elif args.passphrase_env:
        value = os.environ.get(args.passphrase_env)
        if value is None:
            fail(f"{args.passphrase_env} is not set")
        passphrase = value.encode()

    secret = bytes.fromhex(args.key_hex) if args.key_hex else None
    if secret is not None and len(secret) != 32:
        fail("--key-hex must be 32 bytes of X25519 secret")

    with open(args.file, "rb") as handle:
        blob = handle.read()

    plaintext, summary = read_container(blob, passphrase, secret)
    fields = " ".join(f"{key}={value}" for key, value in summary.items())
    sys.stderr.write(f"read_melv: {fields} plaintext={len(plaintext)}\n")

    if args.out:
        with open(args.out, "wb") as handle:
            handle.write(plaintext)
    else:
        sys.stdout.buffer.write(plaintext)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
