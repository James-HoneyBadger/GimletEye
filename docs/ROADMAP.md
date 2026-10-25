# Roadmap

Each milestone is a shippable increment. Every item has an acceptance
criterion so "done" is not a matter of opinion.

## Path to 1.0

[ADR 0006](adr/0006-what-1.0-promises.md) decides *what* 1.0 promises; this is
the order the work happens in. Two rules shape the sequence:

1. **Surface work goes first.** Anything that adds to or reshapes a versioned
   surface — a new container version, the shape of `Report.data`, an API token
   in the config — lands before the quiet period, because the quiet period is
   what makes the freeze credible.
2. **The last two minors change nothing versioned.** 0.6 and 0.7 are spent on
   evidence, packaging, and documentation, and 1.0 is cut from the end of 0.7.

Effort below is for one maintainer, focused, and assumes the review findings
stay closed.

| Release | Theme | Gates | Surface change | Effort |
|---|---|---|---|---|
| 0.4 | Foundation hardening | G2 start, G3 design | yes | ~4 weeks |
| 0.5 | Key management, formats | G1, G3 | yes — the last one | ~6 weeks |
| 0.6 | Quiet: evidence | G2 complete | **no** | ~3 weeks + soak |
| 0.7 | Quiet: distribution, docs | G4, G5 | **no** | ~5 weeks |
| 1.0 | Freeze and audit | G3 | — | ~1 week |

**Start here (0.4, in this order):** API bearer token → platform field →
`Report.data` convention → fuzz harness → MSRV job. Each is independently
shippable and none of them adds a feature users have to learn.

### Sequencing risks

| Risk | Mitigation |
|---|---|
| OpenPGP drags in weight and slips | Timeboxed inside 0.5, behind a feature flag; drop the claim rather than delay the freeze |
| The seven-day soak starts too late | Land the fuzz harness in 0.4 so the soak overlaps 0.5 |
| Distro acceptance is not ours to control | Scope Gate 4 to recipes and CI artifacts; inclusion upstream is not a gate |
| A surface change surfaces during 0.6 or 0.7 | Take it, and restart the quiet counter at the next minor — the rule is what makes 1.0 mean something |
| The keystore is a new place to leak secrets | Threat-model it in SECURITY.md and pin file mode, zeroization, and failure modes with tests before 0.5 ships |

## v0.1 — Foundations (shipped)

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
  *Scheduled in v0.5.*
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
- [x] Streaming container (v2) for multi-gigabyte files.
  *Acceptance:* bounded memory on a 10 GB input; v1 files still open.
  *Landed as* chunked AEAD framing with a per-chunk counter, position, and
  final-flag in the associated data ([ADR 0005](adr/0005-chunked-container-v2.md)).
  Measured peak RSS is 22.7 MiB for a 512 MiB and a 2 GiB input alike; a real
  0.2.0 container is a compatibility fixture.
- [ ] Keystore tools (`crypto.key-list`, encrypted storage) and key wrapping.
  *Scheduled in v0.5.*
  *Acceptance:* secrets are zeroized on drop; a keystore survives restart.
- [ ] X25519/RSA and OpenPGP interop.
  *Scheduled in v0.5.*
  *Acceptance:* cross-verification with OpenSSL and `sequoia`.

## v0.4 — Foundation hardening

Theme: make the local API and the parsers defensible, and give the two shapeless
surfaces a shape. Surface changes are allowed and expected here.

**Status: complete — all six items are in `main` and in CI** (`c155c5e`,
`e087217`, `b5e3a8e`, `a805987`, `f0e984a`, `5e72649`). What is left for 0.4 is
the part a checklist cannot do: let it sit. Every item here is new evidence, and
evidence found a real defect in three of the six (a latent form-reload bug, the
`load.1m` key shape, and an MSRV that was never true).

- [x] **Bearer token on `/api/v1`.** Generated on first `serve` into
  `<home>/api-token` (mode 0600); `[api] require_token` in config (additive,
  default `true`); the desktop shell injects the token into the webview; the UI
  sends it on every call.
  *Acceptance:* an unauthenticated `POST /api/v1/run` is 401; a preflight gets no
  grant; the token file is 0600; both `curl` and the UI path are documented.
- [x] **Platform contract.** `ToolManifest.platforms` (optional, absent means
  everywhere); `sysadmin.*` declare `["linux"]`; running them elsewhere returns
  `unsupported` naming the platform.
  *Acceptance:* a test flips the declaration and asserts the error; `tools list`
  shows the platform.
- [x] **`Report.data` shape.** Decide it — a per-tool schema in the manifest, or
  a written convention (object or array of objects, snake_case keys, no
  pre-formatted prose) — and record the decision in COMPATIBILITY.md.
  *Acceptance:* a test walks a sample report per native tool and rejects a shape
  that breaks the convention.
- [x] **Fuzzing infrastructure.** `cargo-fuzz` targets for JPEG, PNG, WebP, and
  EXIF/TIFF, seeded from the golden corpus, on a scheduled CI job.
  *Acceptance:* every target runs clean for ten minutes locally; the CI job
  exists and starts green.
- [x] **MSRV job.** CI builds the workspace on the declared `rust-version`.
  *Acceptance:* it goes red when `rust-version` is raised without the toolchain.
  The first run of the check found the declaration was already wrong: it claimed
  1.82 while `zeroize`, `tokio`, `clap` and `hashbrown` all need 1.85 (Cargo
  1.82 cannot even parse `zeroize_derive`'s edition-2024 manifest). The floor is
  now 1.85, `scripts/check-msrv.sh` fails when the manifest and the job
  disagree, and the job compiles every target `--locked`. The desktop shell, a
  separate workspace, follows Tauri and declares 1.90.
- [x] **Quiet-period enforcement.** ADR 0006 defines the rule; add a CI check
  that diffs the versioned files (`report.rs`, `protocol.rs`, the config schema,
  the container constants) between the last two tags, so a stray change during
  0.6 or 0.7 fails the build instead of being noticed at audit time.
  `scripts/check-quiet-period.sh` does that and a little more: it diffs the last
  tag against `HEAD` continuously (so a stray commit fails the same day, not at
  release time) *and* the two release-to-release stretches the ADR actually
  counts. It stays dormant until v0.5.0 ships, because 0.4/0.5 are precisely the
  releases that move surfaces; `ALLOW_SURFACE_CHANGE` in the workflow is the
  reviewed way to accept a change and restart the counter.

Risk: the token touches every surface (CLI, server, UI, desktop, tests). Land it
first so the rest of the release builds on it.

## v0.5 — Key management and format coverage

Theme: finish the pillars the README already claims. This is the **last minor
allowed to change a versioned surface**.

**Status: complete except the `hb-scrub` pack, which is deferred past 1.0** with
its reason recorded below. The quiet-period check starts enforcing at v0.5.0, so
the two release stretches after this one must be still.

- [x] **Keystore**: `crypto.key-list`, `crypto.key-import`, `crypto.key-export`,
  `crypto.key-rotate`. One sealed file under the app home, Argon2id-derived key,
  AEAD framing reused from the container, secrets zeroized on drop.
  *Acceptance:* survives restart; a wrong passphrase fails closed; no secret ever
  reaches `data`, the summary, or the audit trail; file mode 0600. All four are
  asserted, the last two in `scripts/smoke.sh` against the audit file itself.
- [x] **X25519 recipients and container v3** (ADR 0007). Ephemeral X25519, HKDF
  per file, a recipient block in the header, `crypto.encrypt to=`.
  *Acceptance:* v1 and v2 still open; another key cannot decrypt; a committed v3
  fixture pins the format the way `container-v1.melv` pins v1.
  `crates/crypto/tests/container_compat.rs` holds all three versions side by side.
- [x] **OpenPGP interop**: `crypto.gpg-verify`, `crypto.gpg-encrypt`, behind a
  feature flag (`openpgp`, on by default).
  *Acceptance:* verifies a `gpg`-signed file — done, in
  `crates/crypto/tests/gpg_interop.rs`, which also has `gpg` decrypt what the
  tool encrypted. Scope stayed deliberately narrow: driving the system `gpg`
  rather than reimplementing OpenPGP.
- [ ] **`hb-scrub` pack** for HEIC/AVIF/TIFF/PDF/MP4/RAW/GIF/SVG — **deferred past
  1.0** (ADR 0007, decision 4). *Acceptance:* each advertised format round-trips
  through `metadata-strip`; unsupported constructs warn instead of reporting
  success. That criterion cannot be met or checked without `exiftool` in CI, and
  shipping a pack whose claims nothing verifies is the overstatement ADR 0006
  rejects. The README says "packs, then native", which is a plan, not a claim.
- [x] **Deprecation aliases** for anything renamed on the way here.
  *Acceptance:* the old spelling resolves for one minor. No tool id was renamed;
  the one `Report.data` rename (`algorithm` → `kind` in `crypto.keygen`) reports
  both until 0.6, and COMPATIBILITY.md states the rule.

## v0.6 — Quiet: evidence

Theme: prove the destructive paths, change nothing versioned. The only
acceptable diff to `report.rs`, `protocol.rs`, the config schema, or the
container constants is a bug fix with a test.

- [ ] **Seven-day fuzz soak**, corpus grown from real, licence-clean images.
- [ ] **Golden corpus** in `crates/scrub/tests/golden/`: expected scan decisions
  and stripped-output hashes, plus property tests for idempotence and no growth.
- [ ] **Pack trust**: `[trust] sha256` pinning and `mellivora plugins conformance
  <dir>` running the SDK checklist.
- [ ] **Live-engine UI test** (Playwright): browse → validate → run → read the
  report, including the token path added in 0.4.
- [ ] **Benchmarks** for scan, strip, and encrypt at 10 MiB and 1 GiB, recorded in
  CI so a regression is visible rather than argued about.
- [ ] **Review-checklist rerun**: `cargo deny`, dependency freshness, and the
  twelve review findings re-verified as still fixed.

*Acceptance:* the soak is green, the conformance runner rejects a deliberately
broken pack, and `git diff v0.5..v0.6` shows no change to a versioned surface.

## v0.7 — Quiet: distribution and documentation

Theme: make 1.0 installable and explainable. Still no versioned change.

- [ ] **Signed artifacts**: minisign or cosign over `SHA256SUMS`, with the public
  key in SECURITY.md.
- [ ] **Reproducible builds**: a CI job rebuilds from the tag on a clean runner
  and diffs the digests; a mismatch blocks the release.
- [ ] **Packaging**: Arch PKGBUILD, Debian `debian/`, Fedora spec, `cargo install`
  — built and attached by CI; inclusion upstream is not a gate.
- [ ] **Install → upgrade → rollback rehearsal** in a container per platform,
  carrying a real keystore and audit trail across the rollback.
- [ ] **User guide** (every command and tool with real output), **admin guide**
  (config, audit, packs, token, loopback rule), **pack gallery** (one pack
  written from an empty directory).
- [ ] **Support policy** in SECURITY.md: previous two minors, twelve months.

*Acceptance:* a clean container installs from the package, upgrades, and rolls
back without losing the keystore or the audit trail; every README claim links to
a test, a CI job, or a command.

## v1.0 — Freeze

Cut from the end of 0.7, once the two quiet minors are behind it.

- [x] Release artifacts: CLI archives for Linux (x86_64, aarch64), macOS
  (x86_64, aarch64), and Windows (x86_64); `.deb`/`.AppImage`, `.dmg`, and NSIS
  installers for the desktop app; checksums. `.github/workflows/release.yml`
  builds and attaches them from a tag, and publishes nothing unless every build
  succeeds.
- [ ] **Gate 1 audit** — every claim in the README and in a manifest is either
  implemented or removed.
- [ ] **Gate 2 audit** — fuzz soak, corpus, token, pack trust, MSRV, `cargo deny`,
  and the live-engine UI test are all green in CI.
- [ ] **Gate 3 audit** — the six surfaces frozen, the deprecation policy binding,
  the support window started, and the quiet period diffed to prove nothing moved.
- [ ] **Gate 4 audit** — signed, reproducible, packaged, rehearsed.
- [ ] **Gate 5 audit** — the three guides published, and no unverified claim left.
- [ ] ADR 0006 moves from Proposed to Accepted with the audit results attached.
- [ ] `CHANGELOG.md` gets a 1.0.0 entry stating the promise in one paragraph.

*Acceptance:* every checkbox in ADR 0006 is green, and `git diff v0.5..HEAD`
touches no versioned surface.

## After 1.0

Deferred deliberately: none of it blocks the freeze, and each can ship in a 1.x
minor without a breaking change.

- Native ports of `FailedLoginDetector`, `FilePermissions`, `UserAudit` — the
  pack already serves them behind the same manifest.
- `automation` module: scheduled runs, dry-run default, cron or systemd backend.
- `crates/wasm`: browser-safe tools (scan/strip, hash, passgen).
- TUI (`mellivora tui`) for terminals.
- Windows and macOS parity for the `/proc`- and `df`-based sysadmin tools.
- Random access into a large `.melv` container (today a seek means decrypting
  from the start).

## Explicitly out of scope

- Becoming an IDE. Perl Den's editor, terminal, and tutorials stay in Perl Den.
- A hosted/cloud service. Everything is local by design.
- Reimplementing cryptographic primitives. The toolkit wraps audited
  implementations; it does not invent them.
