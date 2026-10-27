# Tool reference

Every tool in the catalogue, with an example invocation and the output it produced. The examples are run by `scripts/tool-reference.py`, and the output below is a snapshot from one machine — hostname, uptime, and paths belong to whichever machine generated this file, so regenerate it before quoting a number.

`scripts/check-tool-reference.sh` fails when a tool exists that this file does not mention, so a new tool cannot ship undocumented.

Generated 2026-10-27 on Linux aarch64 with `gimlet 0.7.0`.

## Crypto

### `crypto.decrypt`

Decrypt a file — Open an authenticated container with its passphrase  
*writes, native*

```console
$ gimlet crypto.decrypt input=/tmp/gimlet-reference-x6hux1hy/photo.gimlet passphrase_env=DEMO_PASSPHRASE output=/tmp/gimlet-reference-x6hux1hy/decrypted.jpg
✔ crypto.decrypt  (276 ms)
  decrypted /tmp/gimlet-reference-x6hux1hy/photo.gimlet → /tmp/gimlet-reference-x6hux1hy/decrypted.jpg (chacha20-poly1305, 1 chunk(s))

Data
  {
    "algorithm": "chacha20-poly1305",
    "chunks": 1,
    "container_version": 2,
    "dry_run": false,
    "input": "/tmp/gimlet-reference-x6hux1hy/photo.gimlet",
    "output": "/tmp/gimlet-reference-x6hux1hy/decrypted.jpg",
    "plaintext_bytes": 175
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.encrypt`

Encrypt a file — Seal a file into an authenticated container using a passphrase (Argon2id + AEAD)  
*writes, native*

```console
$ gimlet crypto.encrypt input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg output=/tmp/gimlet-reference-x6hux1hy/example.gimlet passphrase_env=DEMO_PASSPHRASE
✔ crypto.encrypt  (274 ms)
  encrypted /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg → /tmp/gimlet-reference-x6hux1hy/example.gimlet (chacha20-poly1305, argon2id, 1 chunk(s))

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
… 8 more line(s)
```

### `crypto.gpg-encrypt`

Encrypt for a GnuPG recipient — Produce an OpenPGP message with the system gpg, for people who already have GPG keys  
*writes, native*

```console
$ gimlet crypto.gpg-encrypt input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg recipient=863D38691DE98512FBB8E531979AACCEC1CCCB06 output=/tmp/gimlet-reference-x6hux1hy/photo.gpg
✔ crypto.gpg-encrypt  (3 ms)
  encrypted /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg for 863D38691DE98512FBB8E531979AACCEC1CCCB06 → /tmp/gimlet-reference-x6hux1hy/photo.gpg (336 bytes)

Data
  {
    "backend": "gpg",
    "dry_run": false,
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "output": "/tmp/gimlet-reference-x6hux1hy/photo.gpg",
    "output_bytes": 336,
    "recipient": "863D38691DE98512FBB8E531979AACCEC1CCCB06"
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.gpg-verify`

Verify a GnuPG signature — Check a detached signature with the system gpg and its keyring  
*native*

```console
$ gimlet crypto.gpg-verify input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg signature=/tmp/gimlet-reference-x6hux1hy/photo.gpg.sig
✔ crypto.gpg-verify  (3 ms)
  signature is valid for /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg (key 863D38691DE98512)

Data
  {
    "backend": "gpg",
    "fingerprint": "863D38691DE98512FBB8E531979AACCEC1CCCB06",
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "signature": "/tmp/gimlet-reference-x6hux1hy/photo.gpg.sig",
    "signer": "Reference Example <reference@example.invalid>",
    "valid": true
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.inspect`

Inspect a container — Report the cipher, KDF parameters, and lengths of an encrypted container  
*native*

```console
$ gimlet crypto.inspect input=/tmp/gimlet-reference-x6hux1hy/photo.gimlet
✔ crypto.inspect  (0 ms)
  /tmp/gimlet-reference-x6hux1hy/photo.gimlet · chacha20-poly1305 · argon2id 19456 KiB/2 iterations · chunked

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
… 9 more line(s)
```

### `crypto.key-export`

Export a key — Write a key from the keystore to a key file; the secret needs an explicit flag  
*writes, native*

```console
$ gimlet crypto.key-export selector=demo output=/tmp/gimlet-reference-x6hux1hy/example.pub passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-export  (276 ms)
  exported ed25519 key 'demo' → /tmp/gimlet-reference-x6hux1hy/example.pub

Data
  {
    "dry_run": false,
    "kind": "ed25519",
    "label": "demo",
    "output": "/tmp/gimlet-reference-x6hux1hy/example.pub",
    "public_key": "4d8d7c910c7c7503f13f26183d1b08c2513e885bc66dcc1d8d836c63e450212d",
    "secret": false
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.key-import`

Import a key — Add a key from a key file into the sealed keystore  
*writes, native*

```console
$ gimlet crypto.key-import key=/tmp/gimlet-reference-x6hux1hy/example.pub label=imported public_only=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-import  (551 ms)
  imported ed25519 key 'imported' (public only)

Data
  {
    "dry_run": false,
    "has_secret": false,
    "id": "6c208e05ace19f11",
    "keys": 2,
    "kind": "ed25519",
    "label": "imported",
    "public_key": "4d8d7c910c7c7503f13f26183d1b08c2513e885bc66dcc1d8d836c63e450212d"
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.key-list`

List keys — List the keys in the sealed keystore: id, label, kind, and public key  
*native*

```console
$ gimlet crypto.key-list passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-list  (276 ms)
  2 key(s): 2 signing, 0 recipient(s)

Data
  {
    "count": 2,
    "keys": [
      {
        "created_at": "2026-10-27T14:50:19Z",
        "id": "b4c6cd6caf5e4367",
        "kind": "ed25519",
        "label": "demo",
        "public_key": "4d8d7c910c7c7503f13f26183d1b08c2513e885bc66dcc1d8d836c63e450212d"
      },
… 11 more line(s)
```

### `crypto.key-rotate`

Rotate the keystore passphrase — Re-seal every key under a new passphrase; key material is not regenerated  
*writes, native*

```console
$ gimlet crypto.key-rotate passphrase_env=DEMO_PASSPHRASE new_passphrase_env=DEMO_NEW_PASSPHRASE --dry-run
✔ crypto.key-rotate  (275 ms)
  would rotate 2 key(s) re-sealed under a new passphrase (key material unchanged)

Data
  {
    "dry_run": true,
    "keys": 2,
    "path": "/tmp/gimlet-reference-x6hux1hy/home/keystore.gimlet",
    "scope": "seal"
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.keygen`

Generate a key — Create an Ed25519 signing key or an X25519 recipient key, in files or in the sealed keystore  
*writes, native*

```console
$ gimlet crypto.keygen label=example kind=ed25519 keystore=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.keygen  (548 ms)
  generated ed25519 key 'example' in the keystore

Data
  {
    "algorithm": "ed25519",
    "dry_run": false,
    "id": "8efaad920c509654",
    "keys": 3,
    "kind": "ed25519",
    "label": "example",
    "public_key": "2b990c38c7340ac05380c7d0843b3c66272d30b0bf41ca2ee402daaed54400bb",
    "public_path": null,
    "secret_path": null,
… 3 more line(s)
```

### `crypto.passgen`

Generate passwords — Cryptographically secure passwords with an estimated entropy budget  
*native*

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
      "&]V&wbS5BEQ6gjs72:OBfF7k"
    ]
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.sha256`

SHA-256 digest — Hash text or a file with SHA-256  
*native*

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
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.sign`

Sign a file — Produce a detached Ed25519 signature for a file  
*writes, native*

```console
$ gimlet crypto.sign input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg key=/tmp/gimlet-reference-x6hux1hy/signing.key output=/tmp/gimlet-reference-x6hux1hy/example.sig
✔ crypto.sign  (0 ms)
  signed /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg → /tmp/gimlet-reference-x6hux1hy/example.sig

Data
  {
    "algorithm": "ed25519",
    "dry_run": false,
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "signature": "/tmp/gimlet-reference-x6hux1hy/example.sig",
    "signature_hex": "bdeb9e1ad7e79fc2187714e3a481605dc3f7fdb145259b2b51d219c60bd728656043f66f384b56079e6c15cf07b9b31fee0f86bd8a0ad91f878531403ac16c0e"
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

### `crypto.verify`

Verify a signature — Check a detached Ed25519 signature against a public key  
*native*

```console
$ gimlet crypto.verify input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg signature=/tmp/gimlet-reference-x6hux1hy/setup.sig key=/tmp/gimlet-reference-x6hux1hy/demo.pub
✔ crypto.verify  (0 ms)
  signature is valid for /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg

Data
  {
    "algorithm": "ed25519",
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "key": "/tmp/gimlet-reference-x6hux1hy/demo.pub",
    "public_key": "4d8d7c910c7c7503f13f26183d1b08c2513e885bc66dcc1d8d836c63e450212d",
    "signature": "/tmp/gimlet-reference-x6hux1hy/setup.sig",
    "valid": true
  }
perlden-pack: Perl Den checkout not found; exposing 0 tools
```

## Privacy

### `privacy.metadata-scan`

Inspect metadata — Report embedded EXIF, GPS, text, and comment regions in a container  
*native*

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
… 45 more line(s)
```

### `privacy.metadata-strip`

Remove metadata — Rewrite a file without selected metadata, optionally reducing GPS precision instead of deleting it  
*writes, native*

```console
$ gimlet privacy.metadata-strip input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg output=/tmp/gimlet-reference-x6hux1hy/stripped.jpg profile=privacy
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
    "output": "/tmp/gimlet-reference-x6hux1hy/stripped.jpg",
    "policy": {
      "categories": [
… 8 more line(s)
```

### `privacy.metadata-verify`

Verify metadata removal — Assert that a file carries no metadata selected by the policy  
*native*

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
… 11 more line(s)
```

## Sysadmin

### `sysadmin.disk-usage`

Disk usage — Filesystem utilisation with warning and critical thresholds  
*native*

```console
$ gimlet sysadmin.disk-usage path=/
✔ sysadmin.disk-usage  (2 ms)
  1 filesystem(s) checked, highest utilisation 24%

Data
  [
    {
      "available_kb": 46698452,
      "filesystem": "/dev/sda2",
      "mount": "/",
      "total_kb": 64237188,
      "use_percent": 24,
      "used_kb": 14243200
    }
  ]
… 1 more line(s)
```

### `sysadmin.system-info`

System information — Host identity, kernel, uptime, load, CPU, and memory snapshot  
*native*

```console
$ gimlet sysadmin.system-info
✔ sysadmin.system-info  (0 ms)
  debian-gnu-linux-12-11 · Debian GNU/Linux 13 (trixie) · 4 cores · up 0d 0h 58m

Data
  {
    "arch": "aarch64",
    "cpu": {
      "cores": 4,
      "mhz": null,
      "model": null
    },
    "hostname": "debian-gnu-linux-12-11",
    "kernel": "6.12.113+deb13-arm64",
    "load": {
… 29 more line(s)
```

## Examples that did not run here

None: every example above ran to completion on this host.

