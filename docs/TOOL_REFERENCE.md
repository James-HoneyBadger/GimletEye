# Tool reference

Every tool in the catalogue, with an example invocation and the output it produced. The examples are run by `scripts/tool-reference.py`, and the output below is a snapshot from one machine — hostname, uptime, and paths belong to whichever machine generated this file, so regenerate it before quoting a number.

`scripts/check-tool-reference.sh` fails when a tool exists that this file does not mention, so a new tool cannot ship undocumented.

Generated 2026-10-30 on Linux aarch64 with `gimlet 1.0.0`.

## Crypto

### `crypto.decrypt`

Decrypt a file — Open an authenticated container with its passphrase  
*writes, engine*

```console
$ gimlet crypto.decrypt input=/tmp/gimlet-reference-sk66yzv7/photo.gimlet passphrase_env=DEMO_PASSPHRASE output=/tmp/gimlet-reference-sk66yzv7/decrypted.jpg
✔ crypto.decrypt  (182 ms)
  decrypted /tmp/gimlet-reference-sk66yzv7/photo.gimlet → /tmp/gimlet-reference-sk66yzv7/decrypted.jpg (chacha20-poly1305, 1 chunk(s))

Data
  {
    "input": "/tmp/gimlet-reference-sk66yzv7/photo.gimlet",
    "output": "/tmp/gimlet-reference-sk66yzv7/decrypted.jpg",
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
$ gimlet crypto.encrypt input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg output=/tmp/gimlet-reference-sk66yzv7/example.gimlet passphrase_env=DEMO_PASSPHRASE
✔ crypto.encrypt  (176 ms)
  encrypted /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg → /tmp/gimlet-reference-sk66yzv7/example.gimlet (chacha20-poly1305, argon2id, 1 chunk(s))

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-sk66yzv7/example.gimlet",
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
$ gimlet crypto.gpg-encrypt input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg recipient=82F64A423AA0243CD81427043DBD80CD3B5D772E output=/tmp/gimlet-reference-sk66yzv7/photo.gpg
✔ crypto.gpg-encrypt  (6 ms)
  encrypted /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg for 82F64A423AA0243CD81427043DBD80CD3B5D772E → /tmp/gimlet-reference-sk66yzv7/photo.gpg (315 bytes)

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-sk66yzv7/photo.gpg",
    "recipient": "82F64A423AA0243CD81427043DBD80CD3B5D772E",
    "output_bytes": 315,
    "backend": "gpg",
    "dry_run": false
  }
```

### `crypto.gpg-verify`

Verify a GnuPG signature — Check a detached signature with the system gpg and its keyring  
*engine*

```console
$ gimlet crypto.gpg-verify input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg signature=/tmp/gimlet-reference-sk66yzv7/photo.gpg.sig
✔ crypto.gpg-verify  (5 ms)
  signature is valid for /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg (key 82F64A423AA0243C)

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-sk66yzv7/photo.gpg.sig",
    "valid": true,
    "fingerprint": "82F64A423AA0243CD81427043DBD80CD3B5D772E",
    "signer": "Reference Example <reference@example.invalid>",
    "backend": "gpg"
  }
```

### `crypto.inspect`

Inspect a container — Report the cipher, KDF parameters, and lengths of an encrypted container  
*engine*

```console
$ gimlet crypto.inspect input=/tmp/gimlet-reference-sk66yzv7/photo.gimlet
✔ crypto.inspect  (1 ms)
  /tmp/gimlet-reference-sk66yzv7/photo.gimlet · chacha20-poly1305 · argon2id · 19 MiB · 2 iteration(s) · 1 lane(s) · chunked

Data
  {
    "path": "/tmp/gimlet-reference-sk66yzv7/photo.gimlet",
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
$ gimlet crypto.key-export selector=demo output=/tmp/gimlet-reference-sk66yzv7/example.pub passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-export  (176 ms)
  exported 'demo' to /tmp/gimlet-reference-sk66yzv7/example.pub

Data
  {
    "label": "demo",
    "kind": "ed25519",
    "public_key": "693c3815887de4f823c7b21867b9aa8d0a1102e1d7a6bf8fa5a1845b572d6e8e",
    "output": "/tmp/gimlet-reference-sk66yzv7/example.pub",
    "secret": false,
    "dry_run": false
  }
```

### `crypto.key-import`

Import a key — Add a key from a key file into the sealed keystore  
*writes, engine*

```console
$ gimlet crypto.key-import key=/tmp/gimlet-reference-sk66yzv7/example.pub label=imported public_only=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-import  (333 ms)
  imported 'imported' (ed25519) into /tmp/gimlet-reference-sk66yzv7/home/keystore.gimlet

Data
  {
    "id": "b54a28cf03fff702",
    "label": "imported",
    "kind": "ed25519",
    "public_key": "693c3815887de4f823c7b21867b9aa8d0a1102e1d7a6bf8fa5a1845b572d6e8e",
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
✔ crypto.key-list  (179 ms)
  2 key(s): 2 signing, 0 recipient(s)

Data
  {
    "path": "/tmp/gimlet-reference-sk66yzv7/home/keystore.gimlet",
    "count": 2,
    "keys": [
      {
        "id": "ca2bf6b7a332a151",
        "label": "demo",
        "kind": "ed25519",
        "public_key": "693c3815887de4f823c7b21867b9aa8d0a1102e1d7a6bf8fa5a1845b572d6e8e",
        "created_at": "2026-10-30T12:00:14.590Z"
… 10 more line(s)
```

### `crypto.key-rotate`

Rotate the keystore passphrase — Re-seal every key under a new passphrase; key material is not regenerated  
*writes, engine*

```console
$ gimlet crypto.key-rotate passphrase_env=DEMO_PASSPHRASE new_passphrase_env=DEMO_NEW_PASSPHRASE --dry-run
✔ crypto.key-rotate  (177 ms)
  would re-seal 2 key(s) under a new passphrase

Data
  {
    "path": "/tmp/gimlet-reference-sk66yzv7/home/keystore.gimlet",
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
✔ crypto.keygen  (327 ms)
  added 'example' to /tmp/gimlet-reference-sk66yzv7/home/keystore.gimlet

Data
  {
    "algorithm": "ed25519",
    "kind": "ed25519",
    "label": "example",
    "id": "da13b6cd4a0fdb7d",
    "public_key": "{\n  \"algorithm\": \"ed25519\",\n  \"public_key\": \"c3b6de3454be3fc99b7a60dbc5a79f2b08fa053e11dc42eab780b775bc2a8adf\"\n}",
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
$ gimlet crypto.pass-audit password_env=DEMO_PASSPHRASE
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
$ gimlet crypto.passgen length=24
✔ crypto.passgen  (1 ms)
  1 password(s) · 24 chars · ~154.2 bits each

Data
  {
    "passwords": [
      ";DI^Y@_uy5!(,=m8HDm4n,@)"
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
✔ crypto.sha256  (1 ms)
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
$ gimlet crypto.sign input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg key=/tmp/gimlet-reference-sk66yzv7/signing.key output=/tmp/gimlet-reference-sk66yzv7/example.sig
✔ crypto.sign  (6 ms)
  signed /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-sk66yzv7/example.sig",
    "algorithm": "ed25519",
    "signature_hex": "9642d81e522fb6e806ea1ba19c3462622a84347c0e12ca6c4837dbbabbe9ce1a3ac643759620a8a80b58ef672c0a5cc0b1627b99cd1ced346da8ae2831e5920a",
    "dry_run": false
  }
```

### `crypto.verify`

Verify a signature — Check a detached Ed25519 signature against a public key  
*engine*

```console
$ gimlet crypto.verify input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg signature=/tmp/gimlet-reference-sk66yzv7/setup.sig key=/tmp/gimlet-reference-sk66yzv7/demo.pub
✔ crypto.verify  (3 ms)
  /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg: signature is valid

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "signature": "/tmp/gimlet-reference-sk66yzv7/setup.sig",
    "key": "/tmp/gimlet-reference-sk66yzv7/demo.pub",
    "public_key": "693c3815887de4f823c7b21867b9aa8d0a1102e1d7a6bf8fa5a1845b572d6e8e",
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
$ gimlet privacy.metadata-strip input=/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg output=/tmp/gimlet-reference-sk66yzv7/stripped.jpg profile=privacy
✔ privacy.metadata-strip  (4 ms)
  cleaned /home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg — removed 177 bytes (identity, text, time)

Data
  {
    "input": "/home/james/GimletEye/packages/engine/test/fixtures/photo-exif-gps.jpg",
    "output": "/tmp/gimlet-reference-sk66yzv7/stripped.jpg",
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
✖ privacy.metadata-verify  (2 ms)
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

### `sysadmin.config-drift`

Configuration drift — Snapshot file hashes under a path and report what changed since  
*writes, native*

```console
$ gimlet sysadmin.config-drift input=/tmp/gimlet-reference-sk66yzv7 max_depth=1 snapshot=true
✔ sysadmin.config-drift  (7 ms)
  recorded 11 file(s) as snapshot 'default'

Data
  []
```

### `sysadmin.disk-usage`

Disk usage — Filesystem utilisation with warning and critical thresholds  
*native*

```console
$ gimlet sysadmin.disk-usage path=/
✔ sysadmin.disk-usage  (9 ms)
  1 filesystem(s) checked, highest utilisation 37%

Data
  [
    {
      "filesystem": "/dev/sda2",
      "total_kb": 64237188,
      "used_kb": 22451344,
      "available_kb": 38490308,
      "use_percent": 37,
      "mount": "/"
    }
  ]
```

### `sysadmin.failed-login-detector`

Failed logins — Repeated authentication failures, grouped by account and source  
*native*

```console
$ gimlet sysadmin.failed-login-detector
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
$ gimlet sysadmin.file-permissions path=/tmp/gimlet-reference-sk66yzv7 max_depth=1
✔ sysadmin.file-permissions  (4 ms)
  14 entries scanned, 0 issue(s)

Data
  []
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
  debian-gnu-linux-12-11 · Debian GNU/Linux 13 (trixie) · 4 cores · up 0d 23h 5m

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
$ gimlet sysadmin.user-audit
✔ sysadmin.user-audit  (3 ms)
  40 account(s) checked, 0 issue(s)

Findings
  i [info    ] accounts.shadow-unreadable: /etc/shadow is not readable by this user; password checks need root  (/etc/shadow)

Data
  []
```

## Examples that did not run here

None: every example above ran to completion on this host.

