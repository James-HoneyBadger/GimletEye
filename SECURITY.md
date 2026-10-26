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
| Passwords, keys | Never logged, never audited, never placed in `summary` or `data`; the keystore is a sealed `.melv` file with mode 0600 |
| Keystore (`keystore.melv`) | Argon2id → AEAD, so a wrong passphrase fails before any JSON is parsed; rotation re-seals the document and does not touch key material |
| Recipient containers (v3) | The recipient list and ephemeral public key are visible in the header; the payload key is wrapped per recipient and the plaintext is not |
| `gpg` (OpenPGP interop) | `crypto.gpg-verify`/`crypto.gpg-encrypt` run the system `gpg` as a subprocess with paths as arguments (never a shell); the tools declare `process:exec` and are off in a `--no-default-features` build |
| Audit entries | `$MELLIVORA_HOME/audit.jsonl` — tool, status, duration, argument **names** |
| API token | `$MELLIVORA_HOME/api-token`, mode 0600, printed once by `serve` so it can be pasted |
| Network | Only tools that declare `network` may use it |
| Plugins | Separate processes; see below |

There is no telemetry, no auto-update check, and no remote logging.

## Threat model

**In scope**

- A malicious or buggy plugin pack.
- A crafted image or document causing a parser to mis-strip data (privacy leak).
- A tool writing to an unintended path.
- Secrets leaking into logs, audit records, or shell-visible output.
- A container header being edited to re-address a file to another recipient (the
  recipient block is authenticated, so this fails rather than redirects).

**Out of scope**

- An attacker with local code execution already.
- Side-channel attacks on the host CPU.
- Compromised upstream dependencies (mitigated by review and `deny.toml`, not
  eliminated).

## Controls

1. **Capabilities.** Tools declare `fs:read`, `fs:write`, `process:exec`,
   `network`, `secrets`, `system`. The pack manifest is the contract: the host
   refuses to dispatch any tool from a pack whose declared capabilities were not
   granted, and refuses to load a pack whose tools request more than its
   manifest declares. Built-ins check their own requirements at entry.
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
7. **Authenticated, loopback-only API.** `mellivora serve` binds `127.0.0.1`,
   requires `Authorization: Bearer <token>` on every `/api/` route, and refuses a
   non-loopback bind unless `--allow-remote` is passed. The token is generated on
   first run into `$MELLIVORA_HOME/api-token` (0600), compared in constant time,
   and never written to a report, a log line, or the audit trail. CORS answers
   only the desktop window, the local dev server, and loopback origins, so a page
   the user visits can neither read nor drive the API.
8. **Path traversal defence** in static file serving.
9. **Fuzzed parsers.** JPEG, PNG, WebP, and EXIF/TIFF have libFuzzer targets
   seeded from a committed corpus (`crates/scrub/fuzz`), soaked nightly in CI, and
   a deterministic mutation sweep runs on every commit. A strip that succeeds must
   leave nothing for the policy to remove — an invariant the fuzzers assert, not
   just the unit tests.

## Cryptographic posture

- **No primitives are written here.** AES-256-GCM, ChaCha20-Poly1305, Argon2id,
  Ed25519, and SHA-256 come from the RustCrypto and dalek crates.
- Password generation uses the OS CSPRNG with rejection sampling (no modulo
  bias) and guarantees at least one character from each enabled class.
- Keys, derived keys, passphrases, and decrypted plaintext are held in
  zeroizing buffers; the secret half of a generated keypair is written with mode
  `0600`.
- The `.melv` container authenticates its own header, so altering the cipher,
  the KDF parameters, or the salt fails decryption instead of weakening it.
  KDF parameters are validated *before* key derivation, so a crafted file
  cannot demand unbounded memory.
- A plaintext file is only written after the authentication tag verifies; there
  is no partial or best-effort decrypt.
- A wrong passphrase and a corrupted file produce the same error, so the tool is
  not a decryption oracle.
- Existing files are never replaced unless the caller passes `overwrite=true`.
- The passphrase is read from an environment variable by preference
  (`passphrase_env`); inline arguments are documented as visible to other local
  users and in shell history. It never appears in a report or audit record.

The format is specified in [docs/CONTAINER.md](docs/CONTAINER.md), including its
known limitations.

## Known accepted risks

| Finding | Why it is accepted | Revisit when |
|---|---|---|
| `GHSA-wrw7-89jp-8q8g` (glib `VariantStrIter` unsoundness, desktop only) | The fix landed in glib 0.20; the GTK3 bindings that carry it are `gtk` 0.19. `tauri` 2.12 and `wry` 0.57 still require `gtk ^0.18`, and `wry` pins `webkit2gtk =2.0.2`, which also requires `gtk ^0.18`. `gtk` 0.18 and 0.19 both link the native `gtk-3`, so they cannot coexist in one binary and the bump is upstream's to make. This shell's own code never constructs the type. Tracked as Dependabot alert #1. | `tauri`/`wry` accept `gtk ^0.19`, or `tauri` 3 builds against GTK4 (glib ≥ 0.20) |
| `RUSTSEC-2024-0370` (proc-macro-error unmaintained, desktop only) | Build-time dependency of `glib-macros`; no runtime code in the binary. | Same gtk-rs bump |

Both are recorded in `apps/desktop/src-tauri/deny.toml`, which CI checks so a
*new* advisory in the desktop graph fails the build rather than going unnoticed.

## Release signing

Release checksums are signed with [minisign](https://jedisct1.github.io/minisign/).
The public key is committed as [`release-key.pub`](release-key.pub):

```text
untrusted comment: minisign public key 5F87CFD4343B9B84
RWSEmzs01M+HX6BEgq9OUX4naG53feGQ01VTaT3SP6Xz1VbX4TXU6ojG
```

Anything claiming to be a Mellivora ToolKit release and not signed by that key is
not one. `scripts/verify-release.sh` uses it by default and fails when the
signature is missing, when the key does not match, or when any listed file does
not match its checksum — a partial verification is not a verification.

The release workflow refuses to publish an unsigned release unless an operator
explicitly passes `unsigned: true`, so a release either carries a signature or
says out loud that it does not.

### Key custody, and the one shortcut taken here

The first key was generated with `minisign -G -W`: **an empty passphrase**, so the
secret half is protected only by the `MINISIGN_SECRET_KEY` repository secret and
GitHub's access controls. That is weaker than an offline, passphrase-protected
key, and it was chosen to get a verifiable release out; it is recorded here
rather than glossed over.

Rotating to a passphrase-protected key is a five-minute job and needs no code
change:

```bash
minisign -G -p release-key.pub -s release-key.sec   # prompted for a passphrase
gh secret set MINISIGN_SECRET_KEY < release-key.sec # store, then delete the file
git commit -am "chore(release): rotate the signing key" && git tag -f vX.Y.Z
```

A rotation is visible: the public key in this file changes, and releases before
the change verify against the old key only.

To verify a release:

```bash
./scripts/verify-release.sh SHA256SUMS SHA256SUMS.minisig
```

It fails if the signature is missing, if the key does not match, or if any listed
file does not match its checksum — a partial verification is not a verification.

## Reproducible builds

The same tag produces the same binary bytes: absolute paths are remapped, the
build is not incremental, and dependencies are locked. The release workflow
rebuilds the tag from a second directory and refuses to publish when the digests
differ. That is what makes an independent rebuild a meaningful check rather than
a ritual.

## Supported versions

| Version | Supported |
|---|---|
| the two most recent minor releases | security fixes |
| anything older | not supported |

The window is **twelve months from a release**, so a minor released a year ago
leaves support even if it is still the newest-but-two. Pre-1.0 the same rule
applies; 1.0 is where it becomes a promise with a published deprecation policy
([ADR 0006](docs/adr/0006-what-1.0-promises.md)).

A security fix is backported when the fix is small and the release it lands in is
still inside the window; otherwise the guidance is to upgrade. Fixes are announced
in `CHANGELOG.md` under "Fixed" with the advisory identifier, and a fix that
changes a versioned surface follows the normal deprecation rule even when it is
security-driven.
