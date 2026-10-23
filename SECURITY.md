# Security policy

Mellivora ToolKit handles credentials, private keys, and files that people
expect to be deleted. Two rules follow: nothing leaves the machine, and nothing
sensitive is written down.

## Reporting a vulnerability

Open a private security advisory on
[GitHub](https://github.com/James-HoneyBadger/Mellivora_ToolKit/security/advisories/new)
rather than a public issue. Include the tool id, the input, and the expected
versus actual behaviour. Please do not include real credentials in a report.

## Data handling

| Data | Where it goes |
|---|---|
| Tool input files | Read locally; written only to the path you specify |
| Passwords, keys | Never logged, never audited, never placed in `summary` |
| Audit entries | `$MELLIVORA_HOME/audit.jsonl` — tool, status, duration, argument **names** |
| Network | Only tools that declare `network` may use it |
| Plugins | Separate processes; see below |

There is no telemetry, no auto-update check, and no remote logging.

## Threat model

**In scope**

- A malicious or buggy plugin pack.
- A crafted image or document causing a parser to mis-strip data (privacy leak).
- A tool writing to an unintended path.
- Secrets leaking into logs, audit records, or shell-visible output.

**Out of scope**

- An attacker with local code execution already.
- Side-channel attacks on the host CPU.
- Compromised upstream dependencies (mitigated by review and `deny.toml`, not
  eliminated).

## Controls

1. **Capabilities.** Tools declare `fs:read`, `fs:write`, `process:exec`,
   `network`, `secrets`, `system`. The plugin host refuses to dispatch a pack
   tool whose declared capabilities were not granted; built-ins check their own
   requirements at entry.
2. **Process isolation for packs.** Packs run as separate processes with
   timeouts (`plugins.timeout_ms`). A hung pack is killed; a crashed pack is
   reported, not propagated.
3. **argv-only execution.** Pack manifests contain `command` arrays, never shell
   strings, so a manifest cannot inject shell syntax.
4. **No secrets in audit.** Enforced by a unit test in `crates/core/src/audit.rs`.
5. **Verified stripping.** `privacy.metadata-strip` re-scans its output and
   fails if metadata remains, including under `--dry-run`.
6. **Byte-preserving removal.** Metadata is removed at the container level; pixel
   data is never re-encoded (which would both degrade quality and risk new
   metadata).
7. **Loopback-only API.** `mellivora serve` binds `127.0.0.1` and has no
   authentication. Do not change the bind address without adding auth.
8. **Path traversal defence** in static file serving.

## Cryptographic posture

- Password generation uses the OS CSPRNG with rejection sampling (no modulo
  bias) and guarantees at least one character from each enabled class.
- Hashing uses RustCrypto's SHA-256.
- The native crypto engine, once implemented, supplies audited primitives (AES-256-GCM,
  ChaCha20-Poly1305, Ed25519, X25519, RSA, Argon2id, scrypt) with zeroized
  secrets. The toolkit wraps those implementations; it does not write its own
  primitives.

## Supported versions

Security fixes land on the latest minor release. Pre-1.0, the newest release is
the supported one.
