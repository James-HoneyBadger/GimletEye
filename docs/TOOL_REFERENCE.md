# Tool reference

Every tool in the catalogue, with an example invocation and the output it produced. The examples are run by `scripts/tool-reference.py`, and the output below is a snapshot from one machine — hostname, uptime, and paths belong to whichever machine generated this file, so regenerate it before quoting a number.

`scripts/check-tool-reference.sh` fails when a tool exists that this file does not mention, so a new tool cannot ship undocumented.

Generated 2026-10-27 on Linux aarch64 with `gimlet 0.7.0`.

## Crypto

### `crypto.decrypt`

Decrypt a file — Open an authenticated container with its passphrase  
*writes, engine*

```console
$ gimlet crypto.decrypt input=/tmp/gimlet-reference-b4gh6ucu/photo.gimlet passphrase_env=DEMO_PASSPHRASE output=/tmp/gimlet-reference-b4gh6ucu/decrypted.jpg
✔ crypto.decrypt  (15 ms)
  decrypted /tmp/gimlet-reference-b4gh6ucu/photo.gimlet → /tmp/gimlet-reference-b4gh6ucu/decrypted.jpg (chacha20-poly1305, 1 chunk(s))

Data
  {
    "algorithm": "chacha20-poly1305",
    "chunks": 1,
    "container_version": 2,
    "dry_run": false,
    "input": "/tmp/gimlet-reference-b4gh6ucu/photo.gimlet",
    "output": "/tmp/gimlet-reference-b4gh6ucu/decrypted.jpg",
    "plaintext_bytes": 175
  }
```

### `crypto.encrypt`

Encrypt a file — Seal a file into an authenticated container using a passphrase (Argon2id + AEAD)  
*writes, engine*

```console
$ gimlet crypto.encrypt input=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg output=/tmp/gimlet-reference-b4gh6ucu/example.gimlet passphrase_env=DEMO_PASSPHRASE
✔ crypto.encrypt  (22 ms)
  encrypted /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg → /tmp/gimlet-reference-b4gh6ucu/example.gimlet (chacha20-poly1305, argon2id, 1 chunk(s))

Data
  {
    "algorithm": "chacha20-poly1305",
    "chunk_size_bytes": 65536,
    "chunks": 1,
    "container_bytes": 245,
    "container_version": 2,
    "dry_run": false,
    "input": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "kdf": {
      "m_cost_kib": 19456,
… 7 more line(s)
```

### `crypto.gpg-encrypt`

Encrypt for a GnuPG recipient — Produce an OpenPGP message with the system gpg, for people who already have GPG keys  
*writes, engine*

```console
$ gimlet crypto.gpg-encrypt input=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg recipient=B5F3967D4B2F08743ADD7D74F72F3914550FCD97 output=/tmp/gimlet-reference-b4gh6ucu/photo.gpg
✔ crypto.gpg-encrypt  (6 ms)
  encrypted /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg for B5F3967D4B2F08743ADD7D74F72F3914550FCD97 → /tmp/gimlet-reference-b4gh6ucu/photo.gpg (336 bytes)

Data
  {
    "backend": "gpg",
    "dry_run": false,
    "input": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "output": "/tmp/gimlet-reference-b4gh6ucu/photo.gpg",
    "output_bytes": 336,
    "recipient": "B5F3967D4B2F08743ADD7D74F72F3914550FCD97"
  }
```

### `crypto.gpg-verify`

Verify a GnuPG signature — Check a detached signature with the system gpg and its keyring  
*engine*

```console
$ gimlet crypto.gpg-verify input=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg signature=/tmp/gimlet-reference-b4gh6ucu/photo.gpg.sig
✔ crypto.gpg-verify  (3 ms)
  signature is valid for /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg (key B5F3967D4B2F0874)

Data
  {
    "backend": "gpg",
    "fingerprint": "B5F3967D4B2F08743ADD7D74F72F3914550FCD97",
    "input": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "signature": "/tmp/gimlet-reference-b4gh6ucu/photo.gpg.sig",
    "signer": "Reference Example <reference@example.invalid>",
    "valid": true
  }
```

### `crypto.inspect`

Inspect a container — Report the cipher, KDF parameters, and lengths of an encrypted container  
*engine*

```console
$ gimlet crypto.inspect input=/tmp/gimlet-reference-b4gh6ucu/photo.gimlet
✔ crypto.inspect  (0 ms)
  /tmp/gimlet-reference-b4gh6ucu/photo.gimlet · chacha20-poly1305 · argon2id 19456 KiB/2 iterations · chunked

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
$ gimlet crypto.key-export selector=demo output=/tmp/gimlet-reference-b4gh6ucu/example.pub passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-export  (18 ms)
  exported ed25519 key 'demo' → /tmp/gimlet-reference-b4gh6ucu/example.pub

Data
  {
    "dry_run": false,
    "kind": "ed25519",
    "label": "demo",
    "output": "/tmp/gimlet-reference-b4gh6ucu/example.pub",
    "public_key": "2124ff4ddc36a03e55367b683aeb0d4199401325d0a54cf753ca7aa66f27edf6",
    "secret": false
  }
```

### `crypto.key-import`

Import a key — Add a key from a key file into the sealed keystore  
*writes, engine*

```console
$ gimlet crypto.key-import key=/tmp/gimlet-reference-b4gh6ucu/example.pub label=imported public_only=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-import  (32 ms)
  imported ed25519 key 'imported' (public only)

Data
  {
    "dry_run": false,
    "has_secret": false,
    "id": "de7282b2b85e4f97",
    "keys": 2,
    "kind": "ed25519",
    "label": "imported",
    "public_key": "2124ff4ddc36a03e55367b683aeb0d4199401325d0a54cf753ca7aa66f27edf6"
  }
```

### `crypto.key-list`

List keys — List the keys in the sealed keystore: id, label, kind, and public key  
*engine*

```console
$ gimlet crypto.key-list passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-list  (18 ms)
  2 key(s): 2 signing, 0 recipient(s)

Data
  {
    "count": 2,
    "keys": [
      {
        "created_at": "2026-10-27T18:41:51Z",
        "id": "13cf1b33e630d736",
        "kind": "ed25519",
        "label": "demo",
        "public_key": "2124ff4ddc36a03e55367b683aeb0d4199401325d0a54cf753ca7aa66f27edf6"
      },
… 10 more line(s)
```

### `crypto.key-rotate`

Rotate the keystore passphrase — Re-seal every key under a new passphrase; key material is not regenerated  
*writes, engine*

```console
$ gimlet crypto.key-rotate passphrase_env=DEMO_PASSPHRASE new_passphrase_env=DEMO_NEW_PASSPHRASE --dry-run
✔ crypto.key-rotate  (24 ms)
  would rotate 2 key(s) re-sealed under a new passphrase (key material unchanged)

Data
  {
    "dry_run": true,
    "keys": 2,
    "path": "/tmp/gimlet-reference-b4gh6ucu/home/keystore.gimlet",
    "scope": "seal"
  }
```

### `crypto.keygen`

Generate a key — Create an Ed25519 signing key or an X25519 recipient key, in files or in the sealed keystore  
*writes, engine*

```console
$ gimlet crypto.keygen label=example kind=ed25519 keystore=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.keygen  (33 ms)
  generated ed25519 key 'example' in the keystore

Data
  {
    "algorithm": "ed25519",
    "dry_run": false,
    "id": "570ed3d7f630fd27",
    "keys": 3,
    "kind": "ed25519",
    "label": "example",
    "public_key": "dd2a81525a2c5460c21e9d35e738359e13646346e70959b98129f456bcf0575e",
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
      "-}sZ+_jP8[%qZ$^9fGWt9s(H"
    ]
  }
```

### `crypto.sha256`

SHA-256 digest — Hash text or a file with SHA-256  
*engine*

```console
$ gimlet crypto.sha256 path=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg
✔ crypto.sha256  (0 ms)
  sha256:108b2c29a117bb5965dfcf04319bcda5634b11adb2f0dded6e6e7ac040b06f18

Data
  {
    "backend": "native",
    "sha256": "108b2c29a117bb5965dfcf04319bcda5634b11adb2f0dded6e6e7ac040b06f18",
    "size_bytes": 175,
    "source": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg"
  }
```

### `crypto.sign`

Sign a file — Produce a detached Ed25519 signature for a file  
*writes, engine*

```console
$ gimlet crypto.sign input=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg key=/tmp/gimlet-reference-b4gh6ucu/signing.key output=/tmp/gimlet-reference-b4gh6ucu/example.sig
✔ crypto.sign  (0 ms)
  signed /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg → /tmp/gimlet-reference-b4gh6ucu/example.sig

Data
  {
    "algorithm": "ed25519",
    "dry_run": false,
    "input": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "signature": "/tmp/gimlet-reference-b4gh6ucu/example.sig",
    "signature_hex": "80f4bedda9de1e7cacbf20da4fc6c120c685f6cca27716b0aa9e5219306f17d769f924318c82d451622f1d51170028cacd0c945510773ed5e75df1661bccdb01"
  }
```

### `crypto.verify`

Verify a signature — Check a detached Ed25519 signature against a public key  
*engine*

```console
$ gimlet crypto.verify input=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg signature=/tmp/gimlet-reference-b4gh6ucu/setup.sig key=/tmp/gimlet-reference-b4gh6ucu/demo.pub
✔ crypto.verify  (0 ms)
  signature is valid for /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg

Data
  {
    "algorithm": "ed25519",
    "input": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "key": "/tmp/gimlet-reference-b4gh6ucu/demo.pub",
    "public_key": "2124ff4ddc36a03e55367b683aeb0d4199401325d0a54cf753ca7aa66f27edf6",
    "signature": "/tmp/gimlet-reference-b4gh6ucu/setup.sig",
    "valid": true
  }
```

## Privacy

### `privacy.metadata-scan`

Inspect metadata — Report embedded EXIF, GPS, text, and comment regions in a container  
*engine*

```console
$ gimlet privacy.metadata-scan input=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg
! privacy.metadata-scan  (0 ms)
  /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg · jpeg · 5 segments · 99 bytes removable (identity, text, time)

Findings
  ! [medium  ] metadata.present: 99 bytes removable under this policy: Comment, EXIF (including GPS)

Data
  {
    "format": "jpeg",
    "metadata_bytes": 99,
    "path": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "policy": {
      "categories": [
        "identity",
… 44 more line(s)
```

### `privacy.metadata-strip`

Remove metadata — Rewrite a file without selected metadata, optionally reducing GPS precision instead of deleting it  
*writes, engine*

```console
$ gimlet privacy.metadata-strip input=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg output=/tmp/gimlet-reference-b4gh6ucu/stripped.jpg profile=privacy
✔ privacy.metadata-strip  (0 ms)
  cleaned /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg — removed 99 bytes (identity, text, time)

Data
  {
    "cleaned_bytes": 76,
    "dry_run": false,
    "format": "jpeg",
    "gps": null,
    "input": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "original_bytes": 175,
    "output": "/tmp/gimlet-reference-b4gh6ucu/stripped.jpg",
    "policy": {
      "categories": [
… 7 more line(s)
```

### `privacy.metadata-verify`

Verify metadata removal — Assert that a file carries no metadata selected by the policy  
*engine*

```console
$ gimlet privacy.metadata-verify input=/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg
✖ privacy.metadata-verify  (0 ms)
  /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg carries metadata (identity, text, time)

Findings
  ▲ [high    ] metadata.remaining: /home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg still carries 99 bytes of metadata: Comment, EXIF (including GPS)

Data
  {
    "format": "jpeg",
    "metadata_bytes": 99,
    "path": "/home/james/GimletEye/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
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
✔ sysadmin.disk-usage  (6 ms)
  1 filesystem(s) checked, highest utilisation 28%

Data
  [
    {
      "filesystem": "/dev/sda2",
      "total_kb": 64237188,
      "used_kb": 16675956,
      "available_kb": 44265696,
      "use_percent": 28,
      "mount": "/"
    }
  ]
```

### `sysadmin.kernel-hardening`

Kernel hardening — Sysctls that expose one user to another, and what this host sets them to  
*native*

```console
$ gimlet sysadmin.kernel-hardening
✖ sysadmin.kernel-hardening  (5 ms)
  2 exposed and 0 weakened of 9 readable settings

Findings
  ▲ [high    ] kernel.exposed: kernel.kptr_restrict is 0 (want >= 1): unprivileged readers otherwise learn kernel addresses from /proc  (/proc/sys/kernel/kptr_restrict)
  ▲ [high    ] kernel.exposed: kernel.yama.ptrace_scope is 0 (want >= 1): without it one process may read another user's memory  (/proc/sys/kernel/yama/ptrace_scope)

Data
  {
    "settings": [
      {
        "name": "kernel.randomize_va_space",
        "value": "2",
        "want": "2",
… 52 more line(s)
```

### `sysadmin.network`

Network interfaces — Interfaces, their state, MTU and address, and the default route  
*native*

```console
$ gimlet sysadmin.network
! sysadmin.network  (4 ms)
  2 interface(s), 1 up, default via 10.211.55.2 on enp0s5

Findings
  i [info    ] network.interface_down: lo is unknown  (lo)
  ! [medium  ] network.null_address: lo reports an all-zero hardware address  (lo)

Data
  {
    "interfaces": [
      {
        "name": "enp0s5",
        "state": "up",
        "mtu": 1500,
… 11 more line(s)
```

### `sysadmin.system-info`

System information — Host identity, kernel, uptime, load, CPU, and memory snapshot  
*native*

```console
$ gimlet sysadmin.system-info
✔ sysadmin.system-info  (4 ms)
  debian-gnu-linux-12-11 · Debian GNU/Linux 13 (trixie) · 4 cores · up 0d 4h 49m

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

