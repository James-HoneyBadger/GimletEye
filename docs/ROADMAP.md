# Roadmap

Each milestone is a shippable increment. Every item has an acceptance
criterion so "done" is not a matter of opinion.

## v0.1 — Foundations (current)

| Item | Status | Acceptance |
|---|---|---|
| `Tool` / `Report` contract | ✅ | `Report` round-trips through JSON; status derived from findings |
| Registry + built-in precedence | ✅ | shorthand resolves to a built-in when a pack collides |
| Config (versioned, namespaced) | ✅ | unknown module keys ignored; newer schema rejected |
| Audit trail (JSONL, no values) | ✅ | test asserts values never serialized |
| Plugin host (JSON-RPC, timeouts, capabilities) | ✅ | broken pack does not block startup |
| First compatibility pack (system audits) | ✅ | external modules listed and runnable |
| CLI / HTTP API / UI / Tauri shell | ✅ | UI lists tools and runs them |
| `sysadmin.system-info`, `sysadmin.disk-usage` | ✅ | fixtures + live host |
| `crypto.passgen`, `crypto.sha256` | ✅ | known-answer tests |
| `privacy.metadata-{scan,strip,verify}` (JPEG/PNG/WebP) | ✅ | strip is byte-preserving and re-verified |
| CI: fmt, clippy, tests, UI build, live Perl slice | ✅ | green on push |
| `--strict` exit codes for CI | ✅ | warning verdicts fail the build |
| `mutates` on every manifest | ✅ | `tools list` shows it; the workbench offers dry run only for tools that write |
| `GET /api/v1/audit` + recent-runs view | ✅ | the workbench lists past runs without reading the file by hand |
| UI test suite (vitest) | ✅ | search, validation, CLI preview, sheets, and a run flow are covered |

## v0.2 — Privacy parity

- [x] Privacy profiles and GPS redaction (see [ENHANCEMENTS.md](ENHANCEMENTS.md)).
- [ ] `hb-scrub` Node pack exposing the formats that are still unsupported.
  *Acceptance:* HEIC/PDF/MP4 round-trip through `mellivora metadata-strip`;
  unsupported constructs produce warnings, not silent success.
- [x] Privacy profiles (`privacy`, `sharing`, `archive`) and field-level `keep`/`remove`.
  *Acceptance:* `--profile` changes the removable set; a unit test pins each set.
- [x] Batch execution across files with a concurrency limit.
  *Acceptance:* 100 files processed with a per-file report and one aggregate
  summary; failures do not abort the run.
  *Landed as* `mellivora batch` with `--concurrency`, `--fail-fast`, `--ext`,
  and `--input-arg`; covered by unit tests and the smoke suite.
- [x] GPS redaction (truncate to region) for JPEG/PNG/WebP.
  *Acceptance:* coordinates reduced to the requested precision; verify mode
  reports remaining precision.

## v0.3 — Crypto engine

- [x] A native engine implements `CryptoBackend`.
  *Acceptance:* known-answer tests for AES-256-GCM, ChaCha20-Poly1305, Argon2id,
  and Ed25519 (RFC 8032 vector).
- [x] `crypto.encrypt` / `crypto.decrypt` over the `.melv` container.
  *Acceptance:* round-trip both ciphers; header tampering and wrong passphrases
  fail closed; header readable without the passphrase.
- [x] `crypto.sign` / `crypto.verify` (Ed25519).
  *Acceptance:* RFC 8032 known-answer test; a modified file fails verification.
- [ ] Streaming container (v2) for multi-gigabyte files.
  *Acceptance:* bounded memory on a 10 GB input; v1 files still open.
- [ ] Keystore tools (`crypto.key-list`, encrypted storage) and key wrapping.
  *Acceptance:* secrets are zeroized on drop; a keystore survives restart.
- [ ] X25519/RSA and OpenPGP interop.
  *Acceptance:* cross-verification with OpenSSL and `sequoia`.

## v0.4 — Consolidation

- [ ] Native ports for `FailedLoginDetector`, `FilePermissions`, `UserAudit`.
  *Acceptance:* parity fixtures from Perl Den's `t/` suite.
- [ ] `automation` module: scheduled runs, dry-run default, cron backend.
  *Acceptance:* dry-run never writes; a scheduled job records an audit entry.
- [ ] `crates/wasm`: browser-safe tools (scan/strip, hash, passgen).
  *Acceptance:* the demo page runs `metadata-strip` on a dropped file with no
  network access.
- [ ] TUI for terminals (`mellivora tui`).
  *Acceptance:* browse, filter, and run any tool without a GUI.

## v1.0 — Distribution

- [ ] Signed releases: CLI + server for Linux/macOS/Windows; Tauri installers.
- [ ] Distro packaging (Arch, Debian, Fedora) and `cargo install`.
- [ ] Stable `Report` and plugin protocol v1 with a written compatibility policy.
- [ ] Documentation set complete: user guide, admin guide, pack gallery.
- [ ] Retire legacy compatibility surfaces once their users have a replacement
  (see [COMPATIBILITY.md](COMPATIBILITY.md)).

## Explicitly out of scope

- Becoming an IDE. Perl Den's editor, terminal, and tutorials stay in Perl Den.
- A hosted/cloud service. Everything is local by design.
- Reimplementing cryptographic primitives. The toolkit wraps audited
  implementations; it does not invent them.
