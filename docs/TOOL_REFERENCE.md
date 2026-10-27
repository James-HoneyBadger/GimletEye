# Tool reference

Every tool in the catalogue, with an example invocation and the output it produced. The examples are run by `scripts/tool-reference.py`, and the output below is a snapshot from one machine — hostname, uptime, and paths belong to whichever machine generated this file, so regenerate it before quoting a number.

`scripts/check-tool-reference.sh` fails when a tool exists that this file does not mention, so a new tool cannot ship undocumented.

Generated 2026-10-27 on Linux aarch64 with `gimlet 0.7.0`.

## Crypto

### `crypto.decrypt`

Decrypt a file — Open an authenticated container with its passphrase  
*writes, engine*

```console
$ gimlet crypto.decrypt input=/tmp/gimlet-reference-huduhqhm/photo.gimlet passphrase_env=DEMO_PASSPHRASE output=/tmp/gimlet-reference-huduhqhm/decrypted.jpg
✔ crypto.decrypt  (275 ms)
  decrypted /tmp/gimlet-reference-huduhqhm/photo.gimlet → /tmp/gimlet-reference-huduhqhm/decrypted.jpg (chacha20-poly1305, 1 chunk(s))

Data
  {
    "algorithm": "chacha20-poly1305",
    "chunks": 1,
    "container_version": 2,
    "dry_run": false,
    "input": "/tmp/gimlet-reference-huduhqhm/photo.gimlet",
    "output": "/tmp/gimlet-reference-huduhqhm/decrypted.jpg",
    "plaintext_bytes": 175
  }
```

### `crypto.encrypt`

Encrypt a file — Seal a file into an authenticated container using a passphrase (Argon2id + AEAD)  
*writes, engine*

```console
$ gimlet crypto.encrypt input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg output=/tmp/gimlet-reference-huduhqhm/example.gimlet passphrase_env=DEMO_PASSPHRASE
✔ crypto.encrypt  (274 ms)
  encrypted /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg → /tmp/gimlet-reference-huduhqhm/example.gimlet (chacha20-poly1305, argon2id, 1 chunk(s))

Data
  {
    "algorithm": "chacha20-poly1305",
    "chunk_size_bytes": 65536,
    "chunks": 1,
    "container_bytes": 245,
    "container_version": 2,
    "dry_run": false,
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "kdf": {
      "m_cost_kib": 19456,
… 7 more line(s)
```

### `crypto.gpg-encrypt`

Encrypt for a GnuPG recipient — Produce an OpenPGP message with the system gpg, for people who already have GPG keys  
*writes, engine*

```console
$ gimlet crypto.gpg-encrypt input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg recipient=618CF48A1F65DE64EB7097A4472362743753DC9A output=/tmp/gimlet-reference-huduhqhm/photo.gpg
✔ crypto.gpg-encrypt  (3 ms)
  encrypted /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg for 618CF48A1F65DE64EB7097A4472362743753DC9A → /tmp/gimlet-reference-huduhqhm/photo.gpg (336 bytes)

Data
  {
    "backend": "gpg",
    "dry_run": false,
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "output": "/tmp/gimlet-reference-huduhqhm/photo.gpg",
    "output_bytes": 336,
    "recipient": "618CF48A1F65DE64EB7097A4472362743753DC9A"
  }
```

### `crypto.gpg-verify`

Verify a GnuPG signature — Check a detached signature with the system gpg and its keyring  
*engine*

```console
$ gimlet crypto.gpg-verify input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg signature=/tmp/gimlet-reference-huduhqhm/photo.gpg.sig
✔ crypto.gpg-verify  (3 ms)
  signature is valid for /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg (key 618CF48A1F65DE64)

Data
  {
    "backend": "gpg",
    "fingerprint": "618CF48A1F65DE64EB7097A4472362743753DC9A",
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "signature": "/tmp/gimlet-reference-huduhqhm/photo.gpg.sig",
    "signer": "Reference Example <reference@example.invalid>",
    "valid": true
  }
```

### `crypto.inspect`

Inspect a container — Report the cipher, KDF parameters, and lengths of an encrypted container  
*engine*

```console
$ gimlet crypto.inspect input=/tmp/gimlet-reference-huduhqhm/photo.gimlet
✔ crypto.inspect  (0 ms)
  /tmp/gimlet-reference-huduhqhm/photo.gimlet · chacha20-poly1305 · argon2id 19456 KiB/2 iterations · chunked

Data
  {
    "algorithm": "chacha20-poly1305",
    "ciphertext_bytes": 196,
    "container_bytes": 245,
    "container_version": 2,
    "ephemeral_key": null,
    "kdf": {
      "m_cost_kib": 19456,
      "p_cost": 1,
      "t_cost": 2
… 8 more line(s)
```

### `crypto.key-export`

Export a key — Write a key from the keystore to a key file; the secret needs an explicit flag  
*writes, engine*

```console
$ gimlet crypto.key-export selector=demo output=/tmp/gimlet-reference-huduhqhm/example.pub passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-export  (278 ms)
  exported ed25519 key 'demo' → /tmp/gimlet-reference-huduhqhm/example.pub

Data
  {
    "dry_run": false,
    "kind": "ed25519",
    "label": "demo",
    "output": "/tmp/gimlet-reference-huduhqhm/example.pub",
    "public_key": "a1c2db5e9201996e9aecd976e0836cdbba5a2c4d588219aa01bcda3e873ddcc3",
    "secret": false
  }
```

### `crypto.key-import`

Import a key — Add a key from a key file into the sealed keystore  
*writes, engine*

```console
$ gimlet crypto.key-import key=/tmp/gimlet-reference-huduhqhm/example.pub label=imported public_only=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-import  (553 ms)
  imported ed25519 key 'imported' (public only)

Data
  {
    "dry_run": false,
    "has_secret": false,
    "id": "1c868f5243aa25ad",
    "keys": 2,
    "kind": "ed25519",
    "label": "imported",
    "public_key": "a1c2db5e9201996e9aecd976e0836cdbba5a2c4d588219aa01bcda3e873ddcc3"
  }
```

### `crypto.key-list`

List keys — List the keys in the sealed keystore: id, label, kind, and public key  
*engine*

```console
$ gimlet crypto.key-list passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-list  (277 ms)
  2 key(s): 2 signing, 0 recipient(s)

Data
  {
    "count": 2,
    "keys": [
      {
        "created_at": "2026-10-27T15:10:14Z",
        "id": "536dcd8f04f534b4",
        "kind": "ed25519",
        "label": "demo",
        "public_key": "a1c2db5e9201996e9aecd976e0836cdbba5a2c4d588219aa01bcda3e873ddcc3"
      },
… 10 more line(s)
```

### `crypto.key-rotate`

Rotate the keystore passphrase — Re-seal every key under a new passphrase; key material is not regenerated  
*writes, engine*

```console
$ gimlet crypto.key-rotate passphrase_env=DEMO_PASSPHRASE new_passphrase_env=DEMO_NEW_PASSPHRASE --dry-run
✔ crypto.key-rotate  (276 ms)
  would rotate 2 key(s) re-sealed under a new passphrase (key material unchanged)

Data
  {
    "dry_run": true,
    "keys": 2,
    "path": "/tmp/gimlet-reference-huduhqhm/home/keystore.gimlet",
    "scope": "seal"
  }
```

### `crypto.keygen`

Generate a key — Create an Ed25519 signing key or an X25519 recipient key, in files or in the sealed keystore  
*writes, engine*

```console
$ gimlet crypto.keygen label=example kind=ed25519 keystore=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.keygen  (553 ms)
  generated ed25519 key 'example' in the keystore

Data
  {
    "algorithm": "ed25519",
    "dry_run": false,
    "id": "bae25d5c59aeaafb",
    "keys": 3,
    "kind": "ed25519",
    "label": "example",
    "public_key": "d3d5bf714d1594b47af87d66be333afaeb2ebe7272e9a9b2eb8fd408ab97ae95",
    "public_path": null,
    "secret_path": null,
… 2 more line(s)
```

### `crypto.passgen`

Generate passwords — Cryptographically secure passwords with an estimated entropy budget  
*engine*

```console
$ gimlet crypto.passgen length=24
✔ crypto.passgen  (0 ms)
  1 password(s) · 24 chars · ~154.2 bits each

Data
  {
    "alphabet_size": 86,
    "backend": "native",
    "entropy_bits": 154.2,
    "length": 24,
    "passwords": [
      ".]!BC&24Twmg}&t(C,MBVjb}"
    ]
  }
```

### `crypto.sha256`

SHA-256 digest — Hash text or a file with SHA-256  
*engine*

```console
$ gimlet crypto.sha256 path=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg
✔ crypto.sha256  (0 ms)
  sha256:108b2c29a117bb5965dfcf04319bcda5634b11adb2f0dded6e6e7ac040b06f18

Data
  {
    "backend": "native",
    "sha256": "108b2c29a117bb5965dfcf04319bcda5634b11adb2f0dded6e6e7ac040b06f18",
    "size_bytes": 175,
    "source": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg"
  }
```

### `crypto.sign`

Sign a file — Produce a detached Ed25519 signature for a file  
*writes, engine*

```console
$ gimlet crypto.sign input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg key=/tmp/gimlet-reference-huduhqhm/signing.key output=/tmp/gimlet-reference-huduhqhm/example.sig
✔ crypto.sign  (0 ms)
  signed /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg → /tmp/gimlet-reference-huduhqhm/example.sig

Data
  {
    "algorithm": "ed25519",
    "dry_run": false,
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "signature": "/tmp/gimlet-reference-huduhqhm/example.sig",
    "signature_hex": "7230177b0c97759baf4d8f250450b80405a2ba062527431a0d3d923fdf3adc9e82984270ef91a8f8afa6ea8b134217294e0dac9bfeccbc2a9f3741420e07c606"
  }
```

### `crypto.verify`

Verify a signature — Check a detached Ed25519 signature against a public key  
*engine*

```console
$ gimlet crypto.verify input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg signature=/tmp/gimlet-reference-huduhqhm/setup.sig key=/tmp/gimlet-reference-huduhqhm/demo.pub
✔ crypto.verify  (0 ms)
  signature is valid for /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg

Data
  {
    "algorithm": "ed25519",
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "key": "/tmp/gimlet-reference-huduhqhm/demo.pub",
    "public_key": "a1c2db5e9201996e9aecd976e0836cdbba5a2c4d588219aa01bcda3e873ddcc3",
    "signature": "/tmp/gimlet-reference-huduhqhm/setup.sig",
    "valid": true
  }
```

## Privacy

### `privacy.metadata-scan`

Inspect metadata — Report embedded EXIF, GPS, text, and comment regions in a container  
*engine*

```console
$ gimlet privacy.metadata-scan input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg
! privacy.metadata-scan  (0 ms)
  /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg · jpeg · 5 segments · 99 bytes removable (identity, text, time)

Findings
  ! [medium  ] metadata.present: 99 bytes removable under this policy: Comment, EXIF (including GPS)

Data
  {
    "format": "jpeg",
    "metadata_bytes": 99,
    "path": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "policy": {
      "categories": [
        "identity",
… 44 more line(s)
```

### `privacy.metadata-strip`

Remove metadata — Rewrite a file without selected metadata, optionally reducing GPS precision instead of deleting it  
*writes, engine*

```console
$ gimlet privacy.metadata-strip input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg output=/tmp/gimlet-reference-huduhqhm/stripped.jpg profile=privacy
✔ privacy.metadata-strip  (0 ms)
  cleaned /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg — removed 99 bytes (identity, text, time)

Data
  {
    "cleaned_bytes": 76,
    "dry_run": false,
    "format": "jpeg",
    "gps": null,
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "original_bytes": 175,
    "output": "/tmp/gimlet-reference-huduhqhm/stripped.jpg",
    "policy": {
      "categories": [
… 7 more line(s)
```

### `privacy.metadata-verify`

Verify metadata removal — Assert that a file carries no metadata selected by the policy  
*engine*

```console
$ gimlet privacy.metadata-verify input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg
✖ privacy.metadata-verify  (0 ms)
  /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg carries metadata (identity, text, time)

Findings
  ▲ [high    ] metadata.remaining: /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg still carries 99 bytes of metadata: Comment, EXIF (including GPS)

Data
  {
    "format": "jpeg",
    "metadata_bytes": 99,
    "path": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "policy": {
      "categories": [
        "identity",
… 10 more line(s)
```

## Sysadmin

### `sysadmin.disk-usage`

Disk usage — Filesystem utilisation with warning and critical thresholds  
*native*

```console
$ gimlet sysadmin.disk-usage path=/
✔ sysadmin.disk-usage  (4 ms)
  1 filesystem(s) checked, highest utilisation 26%

Data
  [
    {
      "filesystem": "/dev/sda2",
      "total_kb": 64237188,
      "used_kb": 15342696,
      "available_kb": 45598956,
      "use_percent": 26,
      "mount": "/"
    }
  ]
```

### `sysadmin.system-info`

System information — Host identity, kernel, uptime, load, CPU, and memory snapshot  
*native*

```console
$ gimlet sysadmin.system-info
✔ sysadmin.system-info  (5 ms)
  debian-gnu-linux-12-11 · Debian GNU/Linux 13 (trixie) · 4 cores · up 0d 1h 18m

Data
  {
    "hostname": "debian-gnu-linux-12-11",
    "kernel": "6.12.113+deb13-arm64",
    "os": {
      "id": "debian",
      "name": "Debian GNU/Linux",
      "version": "13",
      "pretty_name": "Debian GNU/Linux 13 (trixie)"
    },
    "uptime": {
… 27 more line(s)
```

## Examples that did not run here

None: every example above ran to completion on this host.

