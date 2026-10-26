# Tool reference

Every tool in the catalogue, with an example invocation and the output it produced. The examples are run by `scripts/tool-reference.py`, and the output below is a snapshot from one machine — hostname, uptime, and paths belong to whichever machine generated this file, so regenerate it before quoting a number.

`scripts/check-tool-reference.sh` fails when a tool exists that this file does not mention, so a new tool cannot ship undocumented.

Generated 2026-10-25 on Linux aarch64 with `mellivora 0.7.0`.

## Crypto

### `crypto.decrypt`

Decrypt a file — Open an authenticated container with its passphrase  
*writes, native*

```console
$ mellivora crypto.decrypt input=/tmp/mellivora-reference-56ngkw7k/photo.melv passphrase_env=DEMO_PASSPHRASE output=/tmp/mellivora-reference-56ngkw7k/decrypted.jpg
✔ crypto.decrypt  (21 ms)
  decrypted /tmp/mellivora-reference-56ngkw7k/photo.melv → /tmp/mellivora-reference-56ngkw7k/decrypted.jpg (chacha20-poly1305, 1 chunk(s))

Data
  {
    "algorithm": "chacha20-poly1305",
    "chunks": 1,
    "container_version": 2,
    "dry_run": false,
    "input": "/tmp/mellivora-reference-56ngkw7k/photo.melv",
    "output": "/tmp/mellivora-reference-56ngkw7k/decrypted.jpg",
    "plaintext_bytes": 175
  }
```

### `crypto.encrypt`

Encrypt a file — Seal a file into an authenticated container using a passphrase (Argon2id + AEAD)  
*writes, native*

```console
$ mellivora crypto.encrypt input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg output=/tmp/mellivora-reference-56ngkw7k/example.melv passphrase_env=DEMO_PASSPHRASE
✔ crypto.encrypt  (21 ms)
  encrypted /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg → /tmp/mellivora-reference-56ngkw7k/example.melv (chacha20-poly1305, argon2id, 1 chunk(s))

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
*writes, native*

```console
$ mellivora crypto.gpg-encrypt input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg recipient=52B81C0B1BF06CD61CC361CD1733ED5E1D4CDCB2 output=/tmp/mellivora-reference-56ngkw7k/photo.gpg
✔ crypto.gpg-encrypt  (3 ms)
  encrypted /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg for 52B81C0B1BF06CD61CC361CD1733ED5E1D4CDCB2 → /tmp/mellivora-reference-56ngkw7k/photo.gpg (336 bytes)

Data
  {
    "backend": "gpg",
    "dry_run": false,
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "output": "/tmp/mellivora-reference-56ngkw7k/photo.gpg",
    "output_bytes": 336,
    "recipient": "52B81C0B1BF06CD61CC361CD1733ED5E1D4CDCB2"
  }
```

### `crypto.gpg-verify`

Verify a GnuPG signature — Check a detached signature with the system gpg and its keyring  
*native*

```console
$ mellivora crypto.gpg-verify input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg signature=/tmp/mellivora-reference-56ngkw7k/photo.gpg.sig
✔ crypto.gpg-verify  (3 ms)
  signature is valid for /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg (key 52B81C0B1BF06CD6)

Data
  {
    "backend": "gpg",
    "fingerprint": "52B81C0B1BF06CD61CC361CD1733ED5E1D4CDCB2",
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "signature": "/tmp/mellivora-reference-56ngkw7k/photo.gpg.sig",
    "signer": "Reference Example <reference@example.invalid>",
    "valid": true
  }
```

### `crypto.inspect`

Inspect a container — Report the cipher, KDF parameters, and lengths of an encrypted container  
*native*

```console
$ mellivora crypto.inspect input=/tmp/mellivora-reference-56ngkw7k/photo.melv
✔ crypto.inspect  (0 ms)
  /tmp/mellivora-reference-56ngkw7k/photo.melv · chacha20-poly1305 · argon2id 19456 KiB/2 iterations · chunked

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
*writes, native*

```console
$ mellivora crypto.key-export selector=demo output=/tmp/mellivora-reference-56ngkw7k/example.pub passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-export  (20 ms)
  exported ed25519 key 'demo' → /tmp/mellivora-reference-56ngkw7k/example.pub

Data
  {
    "dry_run": false,
    "kind": "ed25519",
    "label": "demo",
    "output": "/tmp/mellivora-reference-56ngkw7k/example.pub",
    "public_key": "f184e6d57b786a4bf9f7b471ced6b9c47be46ed8cbcb8ee08ce1b2973c70375d",
    "secret": false
  }
```

### `crypto.key-import`

Import a key — Add a key from a key file into the sealed keystore  
*writes, native*

```console
$ mellivora crypto.key-import key=/tmp/mellivora-reference-56ngkw7k/example.pub label=imported public_only=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-import  (39 ms)
  imported ed25519 key 'imported' (public only)

Data
  {
    "dry_run": false,
    "has_secret": false,
    "id": "3a6a9930e4ac9299",
    "keys": 2,
    "kind": "ed25519",
    "label": "imported",
    "public_key": "f184e6d57b786a4bf9f7b471ced6b9c47be46ed8cbcb8ee08ce1b2973c70375d"
  }
```

### `crypto.key-list`

List keys — List the keys in the sealed keystore: id, label, kind, and public key  
*native*

```console
$ mellivora crypto.key-list passphrase_env=DEMO_PASSPHRASE
✔ crypto.key-list  (22 ms)
  2 key(s): 2 signing, 0 recipient(s)

Data
  {
    "count": 2,
    "keys": [
      {
        "created_at": "2026-10-26T03:16:01Z",
        "id": "824c220ba67bf890",
        "kind": "ed25519",
        "label": "demo",
        "public_key": "f184e6d57b786a4bf9f7b471ced6b9c47be46ed8cbcb8ee08ce1b2973c70375d"
      },
… 10 more line(s)
```

### `crypto.key-rotate`

Rotate the keystore passphrase — Re-seal every key under a new passphrase; key material is not regenerated  
*writes, native*

```console
$ mellivora crypto.key-rotate passphrase_env=DEMO_PASSPHRASE new_passphrase_env=DEMO_NEW_PASSPHRASE --dry-run
✔ crypto.key-rotate  (20 ms)
  would rotate 2 key(s) re-sealed under a new passphrase (key material unchanged)

Data
  {
    "dry_run": true,
    "keys": 2,
    "path": "/tmp/mellivora-reference-56ngkw7k/home/keystore.melv",
    "scope": "seal"
  }
```

### `crypto.keygen`

Generate a key — Create an Ed25519 signing key or an X25519 recipient key, in files or in the sealed keystore  
*writes, native*

```console
$ mellivora crypto.keygen label=example kind=ed25519 keystore=true passphrase_env=DEMO_PASSPHRASE
✔ crypto.keygen  (40 ms)
  generated ed25519 key 'example' in the keystore

Data
  {
    "algorithm": "ed25519",
    "dry_run": false,
    "id": "537d4ce85f4a922a",
    "keys": 3,
    "kind": "ed25519",
    "label": "example",
    "public_key": "da57e8085ec51f682766eebc274ffb4f506fec2fc934f4794208fb80e6f6ec38",
    "public_path": null,
    "secret_path": null,
… 2 more line(s)
```

### `crypto.passgen`

Generate passwords — Cryptographically secure passwords with an estimated entropy budget  
*native*

```console
$ mellivora crypto.passgen length=24
✔ crypto.passgen  (0 ms)
  1 password(s) · 24 chars · ~154.2 bits each

Data
  {
    "alphabet_size": 86,
    "backend": "native",
    "entropy_bits": 154.2,
    "length": 24,
    "passwords": [
      "X+^TsY)Xp=or9-U{Fc[?mNMN"
    ]
  }
```

### `crypto.sha256`

SHA-256 digest — Hash text or a file with SHA-256  
*native*

```console
$ mellivora crypto.sha256 path=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg
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
*writes, native*

```console
$ mellivora crypto.sign input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg key=/tmp/mellivora-reference-56ngkw7k/signing.key output=/tmp/mellivora-reference-56ngkw7k/example.sig
✔ crypto.sign  (0 ms)
  signed /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg → /tmp/mellivora-reference-56ngkw7k/example.sig

Data
  {
    "algorithm": "ed25519",
    "dry_run": false,
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "signature": "/tmp/mellivora-reference-56ngkw7k/example.sig",
    "signature_hex": "97ef90581a9b949f9532944e5c5569355cefb74653442037fd4a239856b7581c6295dbcc79c7d41434d9a44a2789024f5092c09c50225d6c6f33bfbcde95fe0a"
  }
```

### `crypto.verify`

Verify a signature — Check a detached Ed25519 signature against a public key  
*native*

```console
$ mellivora crypto.verify input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg signature=/tmp/mellivora-reference-56ngkw7k/setup.sig key=/tmp/mellivora-reference-56ngkw7k/demo.pub
✔ crypto.verify  (0 ms)
  signature is valid for /home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg

Data
  {
    "algorithm": "ed25519",
    "input": "/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg",
    "key": "/tmp/mellivora-reference-56ngkw7k/demo.pub",
    "public_key": "f184e6d57b786a4bf9f7b471ced6b9c47be46ed8cbcb8ee08ce1b2973c70375d",
    "signature": "/tmp/mellivora-reference-56ngkw7k/setup.sig",
    "valid": true
  }
```

## Privacy

### `privacy.metadata-scan`

Inspect metadata — Report embedded EXIF, GPS, text, and comment regions in a container  
*native*

```console
$ mellivora privacy.metadata-scan input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg
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
*writes, native*

```console
$ mellivora privacy.metadata-strip input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg output=/tmp/mellivora-reference-56ngkw7k/stripped.jpg profile=privacy
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
    "output": "/tmp/mellivora-reference-56ngkw7k/stripped.jpg",
    "policy": {
      "categories": [
… 7 more line(s)
```

### `privacy.metadata-verify`

Verify metadata removal — Assert that a file carries no metadata selected by the policy  
*native*

```console
$ mellivora privacy.metadata-verify input=/home/james/Mellivora_ToolKit/crates/scrub/tests/golden/fixtures/photo-gps.jpg
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

### `perlden.backup-manager`

Backup Manager — Backup manager — tar/gzip backups with rotation and integrity checks  
*pack*

```console
$ mellivora perlden.backup-manager
✔ perlden.backup-manager  (0 ms)
  BACKUP MANAGER

╔══════════════════════════════════════════════════════════════╗
║                   BACKUP MANAGER                              ║
╚══════════════════════════════════════════════════════════════╝

── Available Backups ─────────────────────────────────────────
  No backups found.
```

### `perlden.bandwidth-monitor`

Bandwidth Monitor — BandwidthMonitor — per-interface traffic stats from /proc/net/dev  
*pack*

```console
$ mellivora perlden.bandwidth-monitor
✔ perlden.bandwidth-monitor  (2000 ms)
  BANDWIDTH MONITOR REPORT

╔══════════════════════════════════════════════════════════════╗
║                  BANDWIDTH MONITOR REPORT                    ║
╚══════════════════════════════════════════════════════════════╝

  Sample interval: 2s

── Interface Traffic ─────────────────────────────────────────
  Interface        RX Total     TX Total    RX Rate    TX Rate   RX Err   TX Err
  ------------------------------------------------------------------------------
  docker0            3.2 MB       2.6 GB    0.0 B/s    0.0 B/s        0        0
  enp0s5             3.7 GB       2.3 GB  11.7 KB/s  19.9 KB/s        0        0
… 3 more line(s)
```

### `perlden.config-diff`

Config Diff — Config diff — baseline snapshots and diff of system configuration files  
*pack*

```console
$ mellivora perlden.config-diff
✔ perlden.config-diff  (2 ms)
  CONFIGURATION DIFF TRACKER

╔══════════════════════════════════════════════════════════════╗
║              CONFIGURATION DIFF TRACKER                       ║
╚══════════════════════════════════════════════════════════════╝

  Baseline Dir: /home/james/.config/perlden/baselines

── File Status ───────────────────────────────────────────────
  File                                     Status       Size         Modified
  ------------------------------------------------------------------------------
  /etc/fstab                               present      902B         2026-09-04 17:13
  /etc/hosts                               present      119B         2025-10-19 08:40
… 13 more line(s)
```

### `perlden.cron-manager`

Cron Manager — Cron manager — list, validate, and analyse crontabs  
*pack*

```console
$ mellivora perlden.cron-manager
✔ perlden.cron-manager  (15 ms)
  CRON MANAGER

╔══════════════════════════════════════════════════════════════╗
║                     CRON MANAGER                              ║
╚══════════════════════════════════════════════════════════════╝

── User Crontabs ─────────────────────────────────────────────

── System Crontab (/etc/crontab) ─────────────────────────────

── /etc/cron.d Entries ────────────────────────────────────────

── Systemd Timers ────────────────────────────────────────────
… 6 more line(s)
```

### `perlden.disk-usage`

Disk Usage — Analyze disk usage by directory — find space hogs  
*pack*

```console
$ mellivora perlden.disk-usage
✔ perlden.disk-usage  (31495 ms)
  DISK USAGE ANALYSIS

╔══════════════════════════════════════════════════════════════╗
║                    DISK USAGE ANALYSIS                       ║
╚══════════════════════════════════════════════════════════════╝

Target: /home/james
Total:  70.8 GB

── Top Directories by Size ───────────────────────────────────
   70.8 GB  ████████████████████████████████████████ /home/james
   20.2 GB    ███████████ /home/james/Mellivora_ToolKit
   14.0 GB    ███████ /home/james/.cache
… 39 more line(s)
```

### `perlden.docker-monitor`

Docker Monitor — DockerMonitor — container status, resource limits, image sizes  
*pack*

```console
$ mellivora perlden.docker-monitor
✔ perlden.docker-monitor  (919 ms)
  DOCKER MONITOR REPORT

╔══════════════════════════════════════════════════════════════╗
║                   DOCKER MONITOR REPORT                      ║
╚══════════════════════════════════════════════════════════════╝

── Containers ────────────────────────────────────────────────
  ID              Name                 Status       Ports      Image
  ------------------------------------------------------------------------

  Total: 0  Running: 0

── Images ────────────────────────────────────────────────────
… 15 more line(s)
```

### `perlden.duplicate-finder`

Duplicate Finder — Duplicate file finder — SHA256-based duplicate detection  
*pack*

```console
$ mellivora perlden.duplicate-finder
✔ perlden.duplicate-finder  (0 ms)
  DUPLICATE FILE FINDER

╔══════════════════════════════════════════════════════════════╗
║                 DUPLICATE FILE FINDER                        ║
╚══════════════════════════════════════════════════════════════╝

  Directory:      .
  Files scanned:  3
  Files hashed:   0
  Duplicate sets: 0
  Wasted space:   0 B

  No duplicates found.
```

### `perlden.failed-login-detector`

Failed Login Detector — Failed login / brute-force detector — auth log analysis  
*pack*

```console
$ mellivora perlden.failed-login-detector
✔ perlden.failed-login-detector  (675 ms)
  FAILED LOGIN / BRUTE-FORCE DETECTOR

╔══════════════════════════════════════════════════════════════╗
║              FAILED LOGIN / BRUTE-FORCE DETECTOR              ║
╚══════════════════════════════════════════════════════════════╝

  Lookback:           24 hours
  Alert Threshold:    5 attempts
  Total Failed:       0
  Total Successful:   0

── ⚠ Flagged IPs (possible brute-force) ──────────────────────
  None detected above threshold.
… 14 more line(s)
```

### `perlden.file-permissions`

File Permissions — Audit file permissions — SUID, SGID, world-writable, orphaned files  
*pack*

```console
$ mellivora perlden.file-permissions
✔ perlden.file-permissions  (49340 ms)
  FILE PERMISSIONS AUDIT

╔══════════════════════════════════════════════════════════════╗
║                FILE PERMISSIONS AUDIT                        ║
╚══════════════════════════════════════════════════════════════╝

Scan target: /

── SUID Files (0) ──
  None found

── SGID Files (0) ──
  None found
… 5005 more line(s)
```

### `perlden.firewall-auditor`

Firewall Auditor — FirewallAuditor — dump & analyze iptables/nftables rules  
*pack*

```console
$ mellivora perlden.firewall-auditor
✔ perlden.firewall-auditor  (87 ms)
  FIREWALL AUDIT REPORT

╔══════════════════════════════════════════════════════════════╗
║                   FIREWALL AUDIT REPORT                      ║
╚══════════════════════════════════════════════════════════════╝

  Active Firewall: iptables

── iptables Rules ────────────────────────────────────────────

── nftables Ruleset ──────────────────────────────────────────
  No nftables rules found.

… 21 more line(s)
```

### `perlden.log-analyzer`

Log Analyzer — Parse and analyze system log files (syslog, auth.log, journalctl)  
*pack*

```console
$ mellivora perlden.log-analyzer
✔ perlden.log-analyzer  (44 ms)
  LOG ANALYZER

╔══════════════════════════════════════════════════════════════╗
║                    LOG ANALYZER                              ║
╚══════════════════════════════════════════════════════════════╝

Log file: journalctl
Total entries analyzed: 5000

── Severity Breakdown ────────────────────────────────────────
  ✗ ERROR      82
  ⚠ WARNING    19
  ● NOTICE     686
… 51 more line(s)
```

### `perlden.network-diag`

Network Diag — Network diagnostics — interfaces, DNS lookups, connectivity  
*pack*

```console
$ mellivora perlden.network-diag
✔ perlden.network-diag  (2081 ms)
  NETWORK DIAGNOSTICS

╔══════════════════════════════════════════════════════════════╗
║                NETWORK DIAGNOSTICS                           ║
╚══════════════════════════════════════════════════════════════╝

── Network Interfaces ────────────────────────────────────────
  lo           127.0.0.1/8        MAC: N/A                State: UNKNOWN
               RX: 2.2 GB  TX: 2.2 GB
  lo           ::1/128            MAC: N/A                State: UNKNOWN
               RX: 2.2 GB  TX: 2.2 GB
  enp0s5       192.168.1.226/24   MAC: 00:1c:42:57:2d:a4  State: UP
               RX: 3.7 GB  TX: 2.3 GB
… 41 more line(s)
```

### `perlden.package-auditor`

Package Auditor — PackageAuditor — installed packages, available updates, orphaned packages  
*pack*

```console
$ mellivora perlden.package-auditor
✔ perlden.package-auditor  (271 ms)
  PACKAGE AUDIT REPORT

╔══════════════════════════════════════════════════════════════╗
║                  PACKAGE AUDIT REPORT                        ║
╚══════════════════════════════════════════════════════════════╝

  Package Manager: pacman
  Installed Packages: 1085

── Available Updates ─────────────────────────────────────────
  System is up to date.

── Orphaned Packages ─────────────────────────────────────────
… 31 more line(s)
```

### `perlden.port-scanner`

Port Scanner — Port scanner — listening ports, open TCP ports, service detection  
*pack*

```console
$ mellivora perlden.port-scanner
✔ perlden.port-scanner  (24 ms)
  PORT & CONNECTION ANALYSIS

╔══════════════════════════════════════════════════════════════╗
║                PORT & CONNECTION ANALYSIS                     ║
╚══════════════════════════════════════════════════════════════╝

── Listening Ports ───────────────────────────────────────────
  Proto    State    Local Address          Peer                   Process
  ------------------------------------------------------------------------
  tcp      LISTEN   0.0.0.0:5355           0.0.0.0:*              -
  tcp      LISTEN   127.0.0.1:11434        0.0.0.0:*              -
  tcp      LISTEN   127.0.0.1:33617        0.0.0.0:*              -
  tcp      LISTEN   127.0.0.1:33639        0.0.0.0:*              code (pid 171349)
… 43 more line(s)
```

### `perlden.process-manager`

Process Manager — List, analyze, and manage running processes  
*pack*

```console
$ mellivora perlden.process-manager
✔ perlden.process-manager  (35 ms)
  PROCESS MANAGER

╔══════════════════════════════════════════════════════════════╗
║                    PROCESS MANAGER                           ║
╚══════════════════════════════════════════════════════════════╝

Total processes shown: 25

── Process List ──────────────────────────────────────────────
     PID  USER        CPU%  MEM%  RSS(KB)  COMMAND
  -----------------------------------------------------------------
   75879  james       24.3  14.9  1212536  /usr/share/code/code --type=renderer --crashp...
   75915  james        6.3   7.4   603232  /usr/share/code/resources/app/node_modules.as...
… 38 more line(s)
```

### `perlden.service-monitor`

Service Monitor — Monitor systemd services — status, failed, enabled/disabled  
*pack*

```console
$ mellivora perlden.service-monitor
✔ perlden.service-monitor  (296 ms)
  SERVICE MONITOR

╔══════════════════════════════════════════════════════════════╗
║                    SERVICE MONITOR                           ║
╚══════════════════════════════════════════════════════════════╝

Total services: 112
  active: 38
  inactive: 67
  not-found: 7

✓ No failed services

… 115 more line(s)
```

### `perlden.ssl-checker`

Ssl Checker — SSL/TLS certificate checker — expiry, chain, cipher analysis  
*pack*

```console
$ mellivora perlden.ssl-checker
mellivora: plugin error: pack 'perlden' error -32003: cannot load PerlDen::Scripts::SSLChecker: Can't locate IO/Socket/SSL.pm in @INC (you may need to install the IO::Socket::SSL module) (@INC entries checked: /home/james/Mellivora_ToolKit/plugins/perlden-pack/../../external/Perl_Den/lib /usr/lib/perl5/5.44/site_perl /usr/share/perl5/site_perl /usr/lib/perl5/5.44/vendor_perl /usr/share/perl5/vendor_perl /usr/lib/perl5/5.44/core_perl /usr/share/perl5/core_perl) at /home/james/Mellivora_ToolKit/plugins/perlden-pack/../../external/Perl_Den/lib/PerlDen/Scripts/SSLChecker.pm line 7, <STDIN> line 3.
BEGIN failed--compilation aborted at /home/james/Mellivora_ToolKit/plugins/perlden-pack/../../external/Perl_Den/lib/PerlDen/Scripts/SSLChecker.pm line 7, <STDIN> line 3.
Compilation failed in require at pack.pl line 170, <STDIN> line 3.
```

### `perlden.system-info`

System Info — Collect comprehensive system information from /proc, uname, etc.  
*pack*

```console
$ mellivora perlden.system-info
✔ perlden.system-info  (21 ms)
  SYSTEM INFORMATION

╔══════════════════════════════════════════════════════════════╗
║                    SYSTEM INFORMATION                        ║
║                    2026-10-25 22:17:30                        ║
╚══════════════════════════════════════════════════════════════╝

── Host ──────────────────────────────────────────────────────
  Hostname:     Arch
  OS:           Arch Linux ARM
  Kernel:       7.3.0-1-aarch64-ARCH
  Architecture: aarch64
  Uptime:       0d 6h 32m
… 31 more line(s)
```

### `perlden.systemd-analyzer`

Systemd Analyzer — SystemdAnalyzer — boot time analysis, failed units deep dive  
*pack*

```console
$ mellivora perlden.systemd-analyzer
✔ perlden.systemd-analyzer  (321 ms)
  SYSTEMD ANALYZER REPORT

╔══════════════════════════════════════════════════════════════╗
║                 SYSTEMD ANALYZER REPORT                      ║
╚══════════════════════════════════════════════════════════════╝

── Boot Time Analysis ────────────────────────────────────────
  Startup finished in 1.984s (kernel) + 1.527s (initrd) + 6.480s (userspace) = 9.992s 
  graphical.target reached after 6.476s in userspace.

── Unit Summary ──────────────────────────────────────────────
  Loaded: 160     Active: 158     Failed: 0

… 28 more line(s)
```

### `perlden.user-audit`

User Audit — Audit user accounts — security checks, password status, shells  
*pack*

```console
$ mellivora perlden.user-audit
✔ perlden.user-audit  (18 ms)
  USER ACCOUNT AUDIT

╔══════════════════════════════════════════════════════════════╗
║                    USER ACCOUNT AUDIT                        ║
╚══════════════════════════════════════════════════════════════╝

Total accounts: 30
Login-capable:  4
Sudo/Wheel:     james

⚠  SECURITY WARNINGS:
   ⚠ Cannot read /etc/shadow (need root) — password checks skipped

… 35 more line(s)
```

### `sysadmin.disk-usage`

Disk usage — Filesystem utilisation with warning and critical thresholds  
*native*

```console
$ mellivora sysadmin.disk-usage path=/
✔ sysadmin.disk-usage  (0 ms)
  1 filesystem(s) checked, highest utilisation 14%

Data
  [
    {
      "available_kb": 455923440,
      "filesystem": "/dev/sda5",
      "mount": "/",
      "total_kb": 531099648,
      "use_percent": 14,
      "used_kb": 73411760
    }
  ]
```

### `sysadmin.system-info`

System information — Host identity, kernel, uptime, load, CPU, and memory snapshot  
*native*

```console
$ mellivora sysadmin.system-info
✔ sysadmin.system-info  (0 ms)
  Arch · Arch Linux ARM · 4 cores · up 0d 6h 32m

Data
  {
    "arch": "aarch64",
    "cpu": {
      "cores": 4,
      "mhz": null,
      "model": null
    },
    "hostname": "Arch",
    "kernel": "7.3.0-1-aarch64-ARCH",
    "load": {
… 28 more line(s)
```

## Examples that did not run here

- `perlden.ssl-checker (exit 1)`

