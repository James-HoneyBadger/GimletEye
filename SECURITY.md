# Security policy

Gimlet Eye handles credentials, private keys, and files that people
expect to be deleted. Two rules follow: nothing leaves the machine, and nothing
sensitive is written down.

## Reporting a vulnerability

Open a private security advisory on
[GitHub](https://github.com/James-HoneyBadger/GimletEye/security/advisories/new)
rather than a public issue. Include the tool id, the input, and the expected
versus actual behaviour. Please do not include real credentials in a report.

## Data handling

| Data | Where it goes |
|---|---|
| Tool input files | Read locally; written only to the path you specify |
| Passwords, keys | Never logged, never audited, never placed in `summary` or `data`; the keystore is a sealed `.gimlet` file with mode 0600 |
| Keystore (`keystore.gimlet`) | Argon2id → AEAD, so a wrong passphrase fails before any JSON is parsed; rotation re-seals the document and does not touch key material |
| Recipient containers (v3) | The recipient list and ephemeral public key are visible in the header; the payload key is wrapped per recipient and the plaintext is not |
| `gpg` (OpenPGP interop) | `crypto.gpg-verify`/`crypto.gpg-encrypt` run the system `gpg` as a subprocess with paths as arguments (never a shell); the tools declare `process:exec` and are off in a `--no-default-features` build |
| Audit entries | `$GIMLET_HOME/audit.jsonl` — tool, status, duration, argument **names** |
| Network | Nothing opens a socket; no tool declares `network` |
| The engine | A separate process the surfaces spawn; it runs only the tools this build compiled |

There is no telemetry, no auto-update check, and no remote logging.

## Threat model

**In scope**

- A crafted container header, or a crafted image.
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

### A hostile container and what it may cost

A `.gimlet` header carries its own Argon2id parameters, and the format accepts up
to 1 GiB of memory and 16 iterations — a peer may legitimately have used strong
settings, and refusing to open their file would be worse than the wait. The cost
of honouring those numbers belongs to whoever asks, so `crypto.decrypt` refuses a
header above 256 MiB and six iterations in about a quarter of a second, names the
parameters, and takes `allow_expensive=true` when the operator vouches for the
file. `crypto.inspect` reads the header without deriving anything.

Without that line a 75-byte file could hold a core for 42 seconds. A fuzz target
found it during the 1.0 soak: a header asking for 595 MiB and nine iterations,
rejected only after the key had been derived, because the chunk check came last.
`crates/crypto/tests/decrypt_cost_budget.rs` pins the refusal, the opt-in, and
that containers written with default parameters still open unasked.

This is a availability control, not a confidentiality one: it does not change
what a container can say, only how much work a stranger can ask for.

## Controls

1. **No network, no listener.** Nothing in the toolkit opens a socket or binds a
   port. The desktop app is reachable only through its own window; the CLI is a
   process that exits. There is no local API to authenticate because there is no
   local API.
2. **One implementation, in the same process.** The crypto and metadata tools
   are TypeScript in `packages/engine`, compiled from this tree. There is no
   discovery of user-supplied executables and no manifest that names a command,
   so the "arbitrary code with declared capabilities" problem is designed out
   rather than audited around.
3. **argv-only execution.** The only external processes are `df` (disk-usage)
   and `gpg` (the OpenPGP interop tools), invoked with argument vectors and never
   through a shell.
4. **No secrets in audit.** Enforced by a unit test in `packages/core/test/audit.test.ts`.
5. **Verified stripping.** `privacy.metadata-strip` re-scans its output and
   fails if metadata remains, including under `--dry-run`.
6. **Byte-preserving removal.** Metadata is removed at the container level; pixel
   data is never re-encoded (which would both degrade quality and risk new
   metadata).
7. **No secrets in reports.** Passphrases are read from an environment variable
   or prompted for; argument *values* never reach a report, a log line, or the
   audit trail, only their names.
8. **Bounded work from untrusted input.** KDF parameters in a hostile header are
   validated before key derivation, so a 75-byte file cannot demand minutes of
   CPU.
9. **Fuzzed parsers.** JPEG, PNG, WebP, and EXIF/TIFF have libFuzzer targets
   seeded from a committed corpus (`crates/scrub/fuzz`), soaked nightly in CI, and
   a deterministic mutation sweep runs on every commit. A strip that succeeds must
   leave nothing for the policy to remove — an invariant the fuzzers assert, not
   just the unit tests.

## Cryptographic posture

- **No primitives are written here.** AES-256-GCM, ChaCha20-Poly1305, Ed25519,
  X25519, HKDF, and SHA-256 come from OpenSSL through `node:crypto`; Argon2id is
  the one gap in Node's own API, and comes from `@noble/hashes`.
- **Key material is zeroed as far as JavaScript allows.** Node's `Buffer`s are
  overwritten after use; this is weaker than Rust's `zeroize`, and the ADR says
  so rather than claiming otherwise.
- Password generation uses the OS CSPRNG with rejection sampling (no modulo
  bias) and guarantees at least one character from each enabled class.
- Keys, derived keys, passphrases, and decrypted plaintext are held in
  zeroizing buffers; the secret half of a generated keypair is written with mode
  `0600`.
- The `.gimlet` container authenticates its own header, so altering the cipher,
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
| *None.* The two that used to be listed here — `GHSA-wrw7-89jp-8q8g` (glib `VariantStrIter` unsoundness) and `RUSTSEC-2024-0370` (proc-macro-error unmaintained) — came from Tauri's GTK3 stack and left the tree with it, when the window moved to Electron. Dependabot alert #1 closes with them. | — | — |

There is one dependency graph now, and the `dependency policy` job in CI runs
`npm audit` over the shipped runtime dependency set, so a new advisory fails the
build rather than going unnoticed.

## Release signing

Release checksums are signed with [minisign](https://jedisct1.github.io/minisign/).
The public key is committed as [`release-key.pub`](release-key.pub):

```text
untrusted comment: minisign public key 5F87CFD4343B9B84
RWSEmzs01M+HX6BEgq9OUX4naG53feGQ01VTaT3SP6Xz1VbX4TXU6ojG
```

Anything claiming to be a Gimlet Eye release and not signed by that key is
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
