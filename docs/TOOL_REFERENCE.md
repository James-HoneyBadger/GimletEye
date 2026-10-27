# Tool reference

Every tool in the catalogue, with an example invocation and the output it produced. The examples are run by `scripts/tool-reference.py`, and the output below is a snapshot from one machine — hostname, uptime, and paths belong to whichever machine generated this file, so regenerate it before quoting a number.

`scripts/check-tool-reference.sh` fails when a tool exists that this file does not mention, so a new tool cannot ship undocumented.

Generated 2026-10-27 on Linux aarch64 with `gimlet 0.7.0`.

## Crypto

### `crypto.decrypt`

Decrypt a file — Open an authenticated container with its passphrase  
*writes, engine*

```console
$ gimlet crypto.decrypt input=/tmp/gimlet-reference-46ubdtkk/photo.gimlet passphrase_env=DEMO_PASSPHRASE output=/tmp/gimlet-reference-46ubdtkk/decrypted.jpg
✔ crypto.decrypt  (250 ms)
  decrypted /tmp/gimlet-reference-46ubdtkk/photo.gimlet → /tmp/gimlet-reference-46ubdtkk/decrypted.jpg (chacha20-poly1305, 1 chunk(s))

Data
  {
    "input": "/tmp/gimlet-reference-46ubdtkk/photo.gimlet",
    "output": "/tmp/gimlet-reference-46ubdtkk/decrypted.jpg",
    "algorithm": "chacha20-poly1305",
    "container_version": 2,
    "chunks": 1,
    "plaintext_bytes": 195,
    "dry_run": false
  }
```

### `crypto.encrypt`

Encrypt a file — Seal a file into an authenticated container using a passphrase (Argon2id + AEAD)  
*writes, engine*

```console
$ gimlet crypto.encrypt input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg output=/tmp/gimlet-reference-46ubdtkk/example.gimlet passphrase_env=DEMO_PASSPHRASE
✔ crypto.encrypt  (231 ms)
  encrypted /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg → /tmp/gimlet-reference-46ubdtkk/example.gimlet (chacha20-poly1305, argon2id, 1 chunk(s))

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-46ubdtkk/example.gimlet",
    "algorithm": "chacha20-poly1305",
    "kdf": "argon2id",
    "recipients": null,
    "plaintext_bytes": 195,
    "container_bytes": 265,
    "dry_run": false
  }
```

### `crypto.gpg-encrypt`

Encrypt for a GnuPG recipient — Produce an OpenPGP message with the system gpg, for people who already have GPG keys  
*writes, engine*

```console
$ gimlet crypto.gpg-encrypt input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg recipient=D60A5749708064FF174650B9A9F5461ADBEA3E33 output=/tmp/gimlet-reference-46ubdtkk/photo.gpg
✔ crypto.gpg-encrypt  (8 ms)
  encrypted /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg for D60A5749708064FF174650B9A9F5461ADBEA3E33 → /tmp/gimlet-reference-46ubdtkk/photo.gpg (315 bytes)

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-46ubdtkk/photo.gpg",
    "recipient": "D60A5749708064FF174650B9A9F5461ADBEA3E33",
    "output_bytes": 315,
    "backend": "gpg",
    "dry_run": false
  }
```

### `crypto.gpg-verify`

Verify a GnuPG signature — Check a detached signature with the system gpg and its keyring  
*engine*

```console
$ gimlet crypto.gpg-verify input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg signature=/tmp/gimlet-reference-46ubdtkk/photo.gpg.sig
✔ crypto.gpg-verify  (15 ms)
  signature is valid for /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg (key D60A5749708064FF)

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-46ubdtkk/photo.gpg.sig",
    "valid": true,
    "fingerprint": "D60A5749708064FF174650B9A9F5461ADBEA3E33",
    "signer": "Reference Example <reference@example.invalid>",
    "backend": "gpg"
  }
```

### `crypto.inspect`

Inspect a container — Report the cipher, KDF parameters, and lengths of an encrypted container  
*engine*

```console
$ gimlet crypto.inspect input=/tmp/gimlet-reference-46ubdtkk/photo.gimlet
✔ crypto.inspect  (1 ms)
  /tmp/gimlet-reference-46ubdtkk/photo.gimlet · chacha20-poly1305 · argon2id · 19 MiB · 2 iteration(s) · 1 lane(s) · chunked

Data
  {
    "path": "/tmp/gimlet-reference-46ubdtkk/photo.gimlet",
    "container_version": 2,
    "streaming": true,
    "max_chunk_bytes": 65552,
    "algorithm": "chacha20-poly1305",
    "kdf": "argon2id",
    "memory_kib": 19456,
    "time_cost": 2,
    "lanes": 1,
… 5 more line(s)
```

### `crypto.key-export`

Export a key — Write a key from the keystore to a key file; the secret needs an explicit flag  
*writes, engine*

```console
$ gimlet crypto.key-export selector=demo output=/tmp/gimlet-reference-46ubdtkk/example.pub passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-export  (213 ms)
  exported 'demo' to /tmp/gimlet-reference-46ubdtkk/example.pub

Data
  {
    "label": "demo",
    "kind": "ed25519",
    "public_key": "d667c41cdf53823d73089f1715fc29df2f64e5c83543eed7d5059cda46442a33",
    "output": "/tmp/gimlet-reference-46ubdtkk/example.pub",
    "secret": false,
    "dry_run": false
  }
```

### `crypto.key-import`

Import a key — Add a key from a key file into the sealed keystore  
*writes, engine*

```console
$ gimlet crypto.key-import key=/tmp/gimlet-reference-46ubdtkk/example.pub label=imported public_only=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-import  (403 ms)
  imported 'imported' (ed25519) into /tmp/gimlet-reference-46ubdtkk/home/keystore.gimlet

Data
  {
    "id": "1234fcb8c38ec56e",
    "label": "imported",
    "kind": "ed25519",
    "public_key": "d667c41cdf53823d73089f1715fc29df2f64e5c83543eed7d5059cda46442a33",
    "has_secret": false,
    "keys": 2,
    "dry_run": false
  }
```

### `crypto.key-list`

List keys — List the keys in the sealed keystore: id, label, kind, and public key  
*engine*

```console
$ gimlet crypto.key-list passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-list  (231 ms)
  2 key(s): 2 signing, 0 recipient(s)

Data
  {
    "path": "/tmp/gimlet-reference-46ubdtkk/home/keystore.gimlet",
    "count": 2,
    "keys": [
      {
        "id": "a92b604c6f582676",
        "label": "demo",
        "kind": "ed25519",
        "public_key": "d667c41cdf53823d73089f1715fc29df2f64e5c83543eed7d5059cda46442a33",
        "created_at": "2026-10-27T22:35:04.810Z"
… 10 more line(s)
```

### `crypto.key-rotate`

Rotate the keystore passphrase — Re-seal every key under a new passphrase; key material is not regenerated  
*writes, engine*

```console
$ gimlet crypto.key-rotate passphrase_env=DEMO_PASSPHRASE new_passphrase_env=DEMO_NEW_PASSPHRASE --dry-run
✔ crypto.key-rotate  (237 ms)
  would re-seal 2 key(s) under a new passphrase

Data
  {
    "path": "/tmp/gimlet-reference-46ubdtkk/home/keystore.gimlet",
    "keys": 2,
    "scope": "seal",
    "dry_run": true
  }
```

### `crypto.keygen`

Generate a key — Create an Ed25519 signing key or an X25519 recipient key, in files or in the sealed keystore  
*writes, engine*

```console
$ gimlet crypto.keygen label=example kind=ed25519 keystore=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.keygen  (410 ms)
  added 'example' to /tmp/gimlet-reference-46ubdtkk/home/keystore.gimlet

Data
  {
    "algorithm": "ed25519",
    "kind": "ed25519",
    "label": "example",
    "id": "1eb703b0e3b65992",
    "public_key": "{\n  \"algorithm\": \"ed25519\",\n  \"public_key\": \"f5662a4a9a485ae464ef1673bca0029da93d4ab5f0a315ffc14471d3fb0cbf5b\"\n}",
    "stored": "keystore",
    "secret_path": null,
    "public_path": null,
    "dry_run": false
… 1 more line(s)
```

### `crypto.passgen`

Generate passwords — Cryptographically secure passwords with an estimated entropy budget  
*engine*

```console
$ gimlet crypto.passgen length=24
✔ crypto.passgen  (1 ms)
  1 password(s) · 24 chars · ~154.2 bits each

Data
  {
    "passwords": [
      "YkXBG^R!5(?q9*AD;LJ3-Fa-"
    ],
    "length": 24,
    "alphabet_size": 86,
    "entropy_bits": 154.2,
    "backend": "node"
  }
```

### `crypto.sha256`

SHA-256 digest — Hash text or a file with SHA-256  
*engine*

```console
$ gimlet crypto.sha256 path=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg
✔ crypto.sha256  (3 ms)
  sha256:fb6b9d85c1b2cb8fb511aed587e253a9a9d9a720ba019f4384cd5169c93ea152

Data
  {
    "sha256": "fb6b9d85c1b2cb8fb511aed587e253a9a9d9a720ba019f4384cd5169c93ea152",
    "size_bytes": 195,
    "source": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "backend": "node"
  }
```

### `crypto.sign`

Sign a file — Produce a detached Ed25519 signature for a file  
*writes, engine*

```console
$ gimlet crypto.sign input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg key=/tmp/gimlet-reference-46ubdtkk/signing.key output=/tmp/gimlet-reference-46ubdtkk/example.sig
✔ crypto.sign  (5 ms)
  signed /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-46ubdtkk/example.sig",
    "algorithm": "ed25519",
    "signature_hex": "6c4966e92442330be0d41ad270cb419667e5518771f5ce52953519997f242738adcffbc91f412137d54cfcac3ef6510a7375a198baa09aeafd32d1c6bc65070b",
    "dry_run": false
  }
```

### `crypto.verify`

Verify a signature — Check a detached Ed25519 signature against a public key  
*engine*

```console
$ gimlet crypto.verify input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg signature=/tmp/gimlet-reference-46ubdtkk/setup.sig key=/tmp/gimlet-reference-46ubdtkk/demo.pub
✔ crypto.verify  (5 ms)
  /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg: signature is valid

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-46ubdtkk/setup.sig",
    "key": "/tmp/gimlet-reference-46ubdtkk/demo.pub",
    "public_key": "d667c41cdf53823d73089f1715fc29df2f64e5c83543eed7d5059cda46442a33",
    "algorithm": "ed25519",
    "valid": true
  }
```

## Privacy

### `privacy.metadata-scan`

Inspect metadata — Report embedded EXIF, GPS, text, and comment regions in a container  
*engine*

```console
$ gimlet privacy.metadata-scan input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg
! privacy.metadata-scan  (2 ms)
  /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg · jpeg · 3 segments · 177 bytes removable (identity, text, time)

Findings
  ! [medium  ] metadata.present: 177 bytes removable under this policy: Comment, EXIF (including GPS)

Data
  {
    "path": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "format": "jpeg",
    "size_bytes": 195,
    "metadata_bytes": 177,
    "removable_bytes": 177,
    "policy": "identity, text, time",
… 28 more line(s)
```

### `privacy.metadata-strip`

Remove metadata — Rewrite a file without selected metadata, optionally reducing GPS precision instead of deleting it  
*writes, engine*

```console
$ gimlet privacy.metadata-strip input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg output=/tmp/gimlet-reference-46ubdtkk/stripped.jpg profile=privacy
✔ privacy.metadata-strip  (4 ms)
  cleaned /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg — removed 177 bytes (identity, text, time)

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-46ubdtkk/stripped.jpg",
    "format": "jpeg",
    "original_bytes": 195,
    "cleaned_bytes": 18,
    "removed_bytes": 177,
    "policy": {
      "categories": [
        "identity",
… 10 more line(s)
```

### `privacy.metadata-verify`

Verify metadata removal — Assert that a file carries no metadata selected by the policy  
*engine*

```console
$ gimlet privacy.metadata-verify input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg
✖ privacy.metadata-verify  (11 ms)
  /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg carries metadata (identity, text, time)

Findings
  ▲ [high    ] metadata.remaining: /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg still carries 177 bytes of metadata: Comment, EXIF (including GPS)

Data
  {
    "path": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "format": "jpeg",
    "metadata_bytes": 177,
    "removable_bytes": 177,
    "policy": "identity, text, time",
    "removable_segments": [
… 4 more line(s)
```

## Sysadmin

### `sysadmin.disk-usage`

Disk usage — Filesystem utilisation with warning and critical thresholds  
*native*

```console
$ gimlet sysadmin.disk-usage path=/
✔ sysadmin.disk-usage  (8 ms)
  1 filesystem(s) checked, highest utilisation 25%

Data
  [
    {
      "filesystem": "/dev/sda2",
      "total_kb": 64237188,
      "used_kb": 14853300,
      "available_kb": 46088352,
      "use_percent": 25,
      "mount": "/"
    }
  ]
```

### `sysadmin.kernel-hardening`

Kernel hardening — Sysctls that expose one user to another, and what this host sets them to  
*native*

```console
$ gimlet sysadmin.kernel-hardening
✖ sysadmin.kernel-hardening  (11 ms)
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
! sysadmin.network  (10 ms)
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
✔ sysadmin.system-info  (9 ms)
  debian-gnu-linux-12-11 · Debian GNU/Linux 13 (trixie) · 4 cores · up 0d 8h 43m

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

