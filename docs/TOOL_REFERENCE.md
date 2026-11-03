# Tool reference

Every tool in the catalogue, with an example invocation and the output it produced. The examples are run by `scripts/tool-reference.py`, and the output below is a snapshot from one machine — hostname, uptime, and paths belong to whichever machine generated this file, so regenerate it before quoting a number.

`scripts/check-tool-reference.sh` fails when a tool exists that this file does not mention, so a new tool cannot ship undocumented.

Generated 2026-10-31 on Linux aarch64 with `gimlet 1.1.0` (Gimlet Eye).
Commands were updated to `gimlet-works` and checkout paths made relative during
the rename; the recorded output remains the original snapshot.

## Crypto

### `crypto.decrypt`

Decrypt a file — Open an authenticated container with its passphrase  
*writes, engine*

```console
$ gimlet-works crypto.decrypt input=/tmp/gimlet-reference-bw90dndx/photo.gimlet passphrase_env=DEMO_PASSPHRASE output=/tmp/gimlet-reference-bw90dndx/decrypted.jpg
✔ crypto.decrypt  (183 ms)
  decrypted /tmp/gimlet-reference-bw90dndx/photo.gimlet → /tmp/gimlet-reference-bw90dndx/decrypted.jpg (chacha20-poly1305, 1 chunk(s))

Data
  {
    "input": "/tmp/gimlet-reference-bw90dndx/photo.gimlet",
    "output": "/tmp/gimlet-reference-bw90dndx/decrypted.jpg",
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
$ gimlet-works crypto.encrypt input=./packages/engine/test/fixtures/photo-exif-gps.jpg output=/tmp/gimlet-reference-bw90dndx/example.gimlet passphrase_env=DEMO_PASSPHRASE
✔ crypto.encrypt  (178 ms)
  encrypted ./packages/engine/test/fixtures/photo-exif-gps.jpg → /tmp/gimlet-reference-bw90dndx/example.gimlet (chacha20-poly1305, argon2id, 1 chunk(s))

Data
  {
    "input": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-bw90dndx/example.gimlet",
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
$ gimlet-works crypto.gpg-encrypt input=./packages/engine/test/fixtures/photo-exif-gps.jpg recipient=D2B651C948BEAD40EF0C7AAF2B0E2661334FD00C output=/tmp/gimlet-reference-bw90dndx/photo.gpg
✔ crypto.gpg-encrypt  (5 ms)
  encrypted ./packages/engine/test/fixtures/photo-exif-gps.jpg for D2B651C948BEAD40EF0C7AAF2B0E2661334FD00C → /tmp/gimlet-reference-bw90dndx/photo.gpg (315 bytes)

Data
  {
    "input": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-bw90dndx/photo.gpg",
    "recipient": "D2B651C948BEAD40EF0C7AAF2B0E2661334FD00C",
    "output_bytes": 315,
    "backend": "gpg",
    "dry_run": false
  }
```

### `crypto.gpg-verify`

Verify a GnuPG signature — Check a detached signature with the system gpg and its keyring  
*engine*

```console
$ gimlet-works crypto.gpg-verify input=./packages/engine/test/fixtures/photo-exif-gps.jpg signature=/tmp/gimlet-reference-bw90dndx/photo.gpg.sig
✔ crypto.gpg-verify  (6 ms)
  signature is valid for ./packages/engine/test/fixtures/photo-exif-gps.jpg (key D2B651C948BEAD40)

Data
  {
    "input": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-bw90dndx/photo.gpg.sig",
    "valid": true,
    "fingerprint": "D2B651C948BEAD40EF0C7AAF2B0E2661334FD00C",
    "signer": "Reference Example <reference@example.invalid>",
    "backend": "gpg"
  }
```

### `crypto.inspect`

Inspect a container — Report the cipher, KDF parameters, and lengths of an encrypted container  
*engine*

```console
$ gimlet-works crypto.inspect input=/tmp/gimlet-reference-bw90dndx/photo.gimlet
✔ crypto.inspect  (2 ms)
  /tmp/gimlet-reference-bw90dndx/photo.gimlet · chacha20-poly1305 · argon2id · 19 MiB · 2 iteration(s) · 1 lane(s) · chunked

Data
  {
    "path": "/tmp/gimlet-reference-bw90dndx/photo.gimlet",
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
$ gimlet-works crypto.key-export selector=demo output=/tmp/gimlet-reference-bw90dndx/example.pub passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-export  (179 ms)
  exported 'demo' to /tmp/gimlet-reference-bw90dndx/example.pub

Data
  {
    "label": "demo",
    "kind": "ed25519",
    "public_key": "7ffcf63c3de1e92a8e3833e72cce0ae8ab285bab3398cfdcacc6da928e801b7c",
    "output": "/tmp/gimlet-reference-bw90dndx/example.pub",
    "secret": false,
    "dry_run": false
  }
```

### `crypto.key-import`

Import a key — Add a key from a key file into the sealed keystore  
*writes, engine*

```console
$ gimlet-works crypto.key-import key=/tmp/gimlet-reference-bw90dndx/example.pub label=imported public_only=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-import  (333 ms)
  imported 'imported' (ed25519) into /tmp/gimlet-reference-bw90dndx/home/keystore.gimlet

Data
  {
    "id": "90d9e0ec0c3efd4c",
    "label": "imported",
    "kind": "ed25519",
    "public_key": "7ffcf63c3de1e92a8e3833e72cce0ae8ab285bab3398cfdcacc6da928e801b7c",
    "has_secret": false,
    "keys": 2,
    "dry_run": false
  }
```

### `crypto.key-list`

List keys — List the keys in the sealed keystore: id, label, kind, and public key  
*engine*

```console
$ gimlet-works crypto.key-list passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-list  (177 ms)
  2 key(s): 2 signing, 0 recipient(s)

Data
  {
    "path": "/tmp/gimlet-reference-bw90dndx/home/keystore.gimlet",
    "count": 2,
    "keys": [
      {
        "id": "fc1c6f0bbb31a36a",
        "label": "demo",
        "kind": "ed25519",
        "public_key": "7ffcf63c3de1e92a8e3833e72cce0ae8ab285bab3398cfdcacc6da928e801b7c",
        "created_at": "2026-11-01T01:03:57.067Z"
… 10 more line(s)
```

### `crypto.key-rotate`

Rotate the keystore passphrase — Re-seal every key under a new passphrase; key material is not regenerated  
*writes, engine*

```console
$ gimlet-works crypto.key-rotate passphrase_env=DEMO_PASSPHRASE new_passphrase_env=DEMO_NEW_PASSPHRASE --dry-run
✔ crypto.key-rotate  (179 ms)
  would re-seal 2 key(s) under a new passphrase

Data
  {
    "path": "/tmp/gimlet-reference-bw90dndx/home/keystore.gimlet",
    "keys": 2,
    "scope": "seal",
    "dry_run": true
  }
```

### `crypto.keygen`

Generate a key — Create an Ed25519 signing key or an X25519 recipient key, in files or in the sealed keystore  
*writes, engine*

```console
$ gimlet-works crypto.keygen label=example kind=ed25519 keystore=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.keygen  (335 ms)
  added 'example' to /tmp/gimlet-reference-bw90dndx/home/keystore.gimlet

Data
  {
    "algorithm": "ed25519",
    "kind": "ed25519",
    "label": "example",
    "id": "995d7a6fd27ed35d",
    "public_key": "{\n  \"algorithm\": \"ed25519\",\n  \"public_key\": \"1f6f9dc2f77f00b4a075c99ecc6a328ca0d8a9b2d5558c7de171fb2720b75eab\"\n}",
    "stored": "keystore",
    "secret_path": null,
    "public_path": null,
    "dry_run": false
… 1 more line(s)
```

### `crypto.pass-audit`

Password audit — Offline strength and pattern audit of an existing password  
*engine*

```console
$ gimlet-works crypto.pass-audit password_env=DEMO_PASSPHRASE
✔ crypto.pass-audit  (1 ms)
  score 4 of 4, 117.7 bits, 0 issue(s)

Data
  {
    "length": 20,
    "entropy_bits": 117.7,
    "score": 4,
    "issues": [],
    "classes": {
      "lowercase": true,
      "uppercase": false,
      "digit": false,
      "symbol": true
… 2 more line(s)
```

### `crypto.passgen`

Generate passwords — Cryptographically secure passwords with an estimated entropy budget  
*engine*

```console
$ gimlet-works crypto.passgen length=24
✔ crypto.passgen  (1 ms)
  1 password(s) · 24 chars · ~154.2 bits each

Data
  {
    "passwords": [
      "sF/41I-z^v2]j_2{hK@q,cQ}"
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
$ gimlet-works crypto.sha256 path=./packages/engine/test/fixtures/photo-exif-gps.jpg
✔ crypto.sha256  (1 ms)
  sha256:fb6b9d85c1b2cb8fb511aed587e253a9a9d9a720ba019f4384cd5169c93ea152

Data
  {
    "sha256": "fb6b9d85c1b2cb8fb511aed587e253a9a9d9a720ba019f4384cd5169c93ea152",
    "size_bytes": 195,
    "source": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
    "backend": "node"
  }
```

### `crypto.sign`

Sign a file — Produce a detached Ed25519 signature for a file  
*writes, engine*

```console
$ gimlet-works crypto.sign input=./packages/engine/test/fixtures/photo-exif-gps.jpg key=/tmp/gimlet-reference-bw90dndx/signing.key output=/tmp/gimlet-reference-bw90dndx/example.sig
✔ crypto.sign  (4 ms)
  signed ./packages/engine/test/fixtures/photo-exif-gps.jpg

Data
  {
    "input": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-bw90dndx/example.sig",
    "algorithm": "ed25519",
    "signature_hex": "4d1157fbd4e4d1e783629b1ff3fde7918778996ed35d875fa8e00cdc05868b3f4b123de2d5026cb5a99852a1f0e27dbf102b0654d7a6585d3c118120878e7300",
    "dry_run": false
  }
```

### `crypto.verify`

Verify a signature — Check a detached Ed25519 signature against a public key  
*engine*

```console
$ gimlet-works crypto.verify input=./packages/engine/test/fixtures/photo-exif-gps.jpg signature=/tmp/gimlet-reference-bw90dndx/setup.sig key=/tmp/gimlet-reference-bw90dndx/demo.pub
✔ crypto.verify  (3 ms)
  ./packages/engine/test/fixtures/photo-exif-gps.jpg: signature is valid

Data
  {
    "input": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-bw90dndx/setup.sig",
    "key": "/tmp/gimlet-reference-bw90dndx/demo.pub",
    "public_key": "7ffcf63c3de1e92a8e3833e72cce0ae8ab285bab3398cfdcacc6da928e801b7c",
    "algorithm": "ed25519",
    "valid": true
  }
```

## Privacy

### `privacy.metadata-scan`

Inspect metadata — Report embedded EXIF, GPS, text, and comment regions in a container  
*engine*

```console
$ gimlet-works privacy.metadata-scan input=./packages/engine/test/fixtures/photo-exif-gps.jpg
! privacy.metadata-scan  (4 ms)
  ./packages/engine/test/fixtures/photo-exif-gps.jpg · jpeg · 3 segments · 177 bytes removable (identity, text, time)

Findings
  ! [medium  ] metadata.present: 177 bytes removable under this policy: Comment, EXIF (including GPS)

Data
  {
    "path": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
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
$ gimlet-works privacy.metadata-strip input=./packages/engine/test/fixtures/photo-exif-gps.jpg output=/tmp/gimlet-reference-bw90dndx/stripped.jpg profile=privacy
✔ privacy.metadata-strip  (3 ms)
  cleaned ./packages/engine/test/fixtures/photo-exif-gps.jpg — removed 177 bytes (identity, text, time)

Data
  {
    "input": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-bw90dndx/stripped.jpg",
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
$ gimlet-works privacy.metadata-verify input=./packages/engine/test/fixtures/photo-exif-gps.jpg
✖ privacy.metadata-verify  (2 ms)
  ./packages/engine/test/fixtures/photo-exif-gps.jpg carries metadata (identity, text, time)

Findings
  ▲ [high    ] metadata.remaining: ./packages/engine/test/fixtures/photo-exif-gps.jpg still carries 177 bytes of metadata: Comment, EXIF (including GPS)

Data
  {
    "path": "./packages/engine/test/fixtures/photo-exif-gps.jpg",
    "format": "jpeg",
    "metadata_bytes": 177,
    "removable_bytes": 177,
    "policy": "identity, text, time",
    "removable_segments": [
… 4 more line(s)
```

## Sysadmin

### `sysadmin.config-drift`

Configuration drift — Snapshot file hashes under a path and report what changed since  
*writes, native*

```console
$ gimlet-works sysadmin.config-drift input=/tmp/gimlet-reference-bw90dndx max_depth=1 snapshot=true
✔ sysadmin.config-drift  (8 ms)
  recorded 11 file(s) as snapshot 'default'

Data
  []
```

### `sysadmin.disk-usage`

Disk usage — Filesystem utilisation with warning and critical thresholds  
*native*

```console
$ gimlet-works sysadmin.disk-usage path=/
✔ sysadmin.disk-usage  (3 ms)
  1 filesystem(s) checked, highest utilisation 67%

Data
  [
    {
      "filesystem": "/dev/sda2",
      "total_kb": 64237188,
      "used_kb": 40402104,
      "available_kb": 20539548,
      "use_percent": 67,
      "mount": "/"
    }
  ]
```

### `sysadmin.failed-login-detector`

Failed logins — Repeated authentication failures, grouped by account and source  
*native*

```console
$ gimlet-works sysadmin.failed-login-detector
✔ sysadmin.failed-login-detector  (1 ms)
  no auth log found; nothing counted

Findings
  i [info    ] login.no-auth-log: none of /var/log/auth.log, /var/log/secure exists; a host that logs only to journald is not read by this tool

Data
  []
```

### `sysadmin.file-permissions`

File permissions — Entries anyone may write, and setuid or setgid files, under a path  
*native*

```console
$ gimlet-works sysadmin.file-permissions path=/tmp/gimlet-reference-bw90dndx max_depth=1
✔ sysadmin.file-permissions  (3 ms)
  14 entries scanned, 0 issue(s)

Data
  []
```

### `sysadmin.kernel-hardening`

Kernel hardening — Sysctls that expose one user to another, and what this host sets them to  
*native*

```console
$ gimlet-works sysadmin.kernel-hardening
✖ sysadmin.kernel-hardening  (7 ms)
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
$ gimlet-works sysadmin.network
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
$ gimlet-works sysadmin.system-info
✔ sysadmin.system-info  (3 ms)
  debian-gnu-linux-12-11 · Debian GNU/Linux 13 (trixie) · 4 cores · up 0d 2h 12m

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

### `sysadmin.user-audit`

User audit — uid 0 accounts, missing passwords, shadow permissions, duplicate ids  
*native*

```console
$ gimlet-works sysadmin.user-audit
✔ sysadmin.user-audit  (2 ms)
  42 account(s) checked, 0 issue(s)

Findings
  i [info    ] accounts.shadow-unreadable: /etc/shadow is not readable by this user; password checks need root  (/etc/shadow)

Data
  []
```

## Examples that did not run here

None: every example above ran to completion on this host.
