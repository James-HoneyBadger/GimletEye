# Roadmap

Each milestone is a shippable increment. Every item has an acceptance
criterion so "done" is not a matter of opinion.

> **The Rust era is history.** [ADR 0010](adr/0010-retire-rust.md) moved the
> engine to TypeScript and deleted `crates/`. Items below that name a crate, a
> `cargo` command, or an MSRV describe what was done *at the time* and are kept
> as a record; where an item is still open, the note says what it became.

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
| CLI / UI / Electron shell | ✅ | UI lists tools and runs them |
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
  *Acceptance:* HEIC/PDF/MP4 round-trip through `gimlet metadata-strip`;
  unsupported constructs produce warnings, not silent success.
- [x] Privacy profiles (`privacy`, `sharing`, `archive`) and field-level `keep`/`remove`.
  *Acceptance:* `--profile` changes the removable set; a unit test pins each set.
- [x] Batch execution across files with a concurrency limit.
  *Acceptance:* 100 files processed with a per-file report and one aggregate
  summary; failures do not abort the run.
  *Landed as* `gimlet batch` with `--concurrency`, `--fail-fast`, `--ext`,
  and `--input-arg`; covered by unit tests and the smoke suite.
- [x] GPS redaction (truncate to region) for JPEG/PNG/WebP.
  *Acceptance:* coordinates reduced to the requested precision; verify mode
  reports remaining precision.

## v0.3 — Crypto engine

- [x] A native engine implements `CryptoBackend`.
  *Acceptance:* known-answer tests for AES-256-GCM, ChaCha20-Poly1305, Argon2id,
  and Ed25519 (RFC 8032 vector).
- [x] `crypto.encrypt` / `crypto.decrypt` over the `.gimlet` container.
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
  disagree, and the job compiles every target `--locked`. The desktop shell is
  TypeScript now (ADR 0011) and declares no Rust version of its own.
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
  fixture pins the format the way `container-v1.gimlet` pins v1.
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
  The harness is ready and green locally (21.1 M executions over four targets,
  three minutes each, corpus growing from 8 seeds to 1 438 inputs); the seven
  green nights accumulate in `fuzz.yml`, which now caches the corpus per target
  so night four starts where night three stopped, and seeds from the golden
  fixtures. The tick waits for the calendar, not for the code.
- [x] **Golden corpus** in `crates/scrub/tests/golden/`: expected scan decisions
  and stripped-output hashes, plus property tests for idempotence and no growth.
  Six synthesized fixtures, the generator that made them, and four tests that
  compare whole documents — so a change in what `metadata-strip` decides shows up
  as a diff. Writing the fixtures caught a wrong ICC segment in the fixture
  itself, which is the corpus doing its job on day one.
- [x] **Pack trust**: `[trust] sha256` pinning and `gimlet plugins conformance
  <dir>` running the SDK checklist. The runner rejects a deliberately broken pack
  in six tests, and it found a real deviation in the reference pack: it answered
  an unknown tool with `-32003` instead of `-32001`.
- [x] **Live-engine UI test** (Playwright): browse → validate → run → read the
  report, including the token path added in 0.4. Four tests, a new `e2e` CI job,
  and the only check in the project that would notice UI/engine wire drift.
- [x] **Benchmarks** for scan, strip, and encrypt at 10 MiB and 1 GiB, recorded in
  CI so a regression is visible rather than argued about. Scan turned out to be
  header-bound (a 1 GiB file scans as fast as a 1 KiB one), so it reports that
  instead of a fake throughput number.
- [x] **Review-checklist rerun**: `cargo deny`, dependency freshness, and the
  twelve review findings re-verified as still fixed. Done in 0.6; the evidence
  is the table in [the 0.6 checklist](#06-review-checklist) below.

*Acceptance:* the soak is green, the conformance runner rejects a deliberately
broken pack, and `git diff v0.5..v0.6` shows no change to a versioned surface.

### 0.6 review checklist

Re-verified rather than assumed. Every finding from the 0.6 review is still
fixed, and the test that would catch a regression if it were not:

| # | Finding | Guard |
|---|---|---|
| 1 | CLI `key=value` text is not rewritten when it looks numeric | `cli_pairs_keep_text_that_only_looks_numeric` |
| 2 | `crypto.sign` cannot destroy its input or silently replace a signature | `sign_refuses_to_overwrite_its_input`, `sign_refuses_to_replace_an_existing_signature` |
| 3 | `metadata-strip` writes atomically and keeps permissions | `a_rewrite_leaves_no_temporary_file_behind`, `in_place_rewrite_keeps_the_original_permissions` |
| 4 | The API needs a token, grants CORS only to known origins, refuses a remote bind | `a_required_policy_needs_the_exact_token`, `refuses_remote_and_opaque_origins`, `a_non_loopback_bind_needs_an_explicit_opt_in` |
| 5 | Pack capabilities are enforced, not advisory | `a_tool_may_not_request_capabilities_the_manifest_omits` |
| 6 | `[defaults] output` is honoured unless a flag overrides it | `json_flag_beats_a_text_default` |
| 7 | `disk-usage path=<relative>` resolves before matching a mount | `relative_paths_are_resolved_before_matching`, `a_relative_path_selects_its_filesystem` |
| 8 | `container::open` reads chunked containers | `open_accepts_a_chunked_container` |
| 9 | An id-less plugin reply is not taken as the answer in flight | `a_notification_before_the_reply_does_not_consume_it` |
| 10 | Audit pruning is atomic and serialised | `concurrent_records_keep_the_trail_capped_and_parseable` |
| 11 | `gimlet batch` reports wall-clock duration | `aggregate_counts_every_outcome` |
| 12 | GPS altitude below sea level is negative | `a_below_sea_level_altitude_is_reported_as_negative` |

Also checked: `cargo deny` is clean on both dependency graphs; the tree resolves
25 direct dependencies with two duplicates (`thiserror` 1 and 2, `syn` — both
pulled by transitive deps); and the deliberate lags are recorded rather than
fixed — `dirs 5`, `toml 0.8`, `sha2 0.10`, and the RustCrypto AEAD crates on
0.10 exist because their next majors changed APIs, which is not work to do in a
release whose whole point is not to move.

## v0.7 — Quiet: distribution and documentation

Theme: make 1.0 installable and explainable. Still no versioned change.

**Status: complete except the signing key**, which is a maintainer action rather
than a code change. Writing it turned up one real contract gap worth recording:
the host never told a pack that a run was a dry run, so the SDK rule "honour
`--dry-run`" was unimplementable. `dry_run` now travels beside `args`.

- [x] **Signed artifacts**: minisign over `SHA256SUMS`, with the public key slot
  in SECURITY.md. The release workflow refuses to publish an unsigned release
  unless an operator passes `unsigned: true`, and `scripts/verify-release.sh`
  verifies signature *and* checksums - tested against a real key: green, tampered
  file, missing signature, wrong key. **The key itself is a maintainer action**
  (generate offline, store as a secret, commit the public half), so the first
  signed release is blocked on that, deliberately: a key that has been through a
  transcript is worth nothing.
- [x] **Reproducible builds**: `--remap-path-prefix` and no incremental
  compilation, verified by building the same tree at two different paths and
  comparing - identical SHA-256, and no absolute path survives in the binary. A
  release job rebuilds the tag from a second directory and refuses to publish on
  a mismatch.
- [x] **Packaging**: `debian/`, `packaging/arch/PKGBUILD` (parsed by `makepkg
  --printsrcinfo`), `packaging/fedora/gimlet-eye-toolkit.spec`, and `cargo install`
  from a tag. `scripts/check-packaging.sh` fails when any of them names a version
  other than the workspace's, and CI builds the `.deb` on every push.
- [x] **Install → upgrade → rollback rehearsal** in a container, carrying a real
  keystore and audit trail: install, create a sealed key, upgrade a patch
  version, roll back, upgrade again - asserting the key id is unchanged, the
  keystore is still 0600, and the audit trail only grew.
- [x] **User guide** (every command with real output), **admin guide** (config,
  audit, packs, token, loopback rule, upgrades), **pack gallery** (a pack written
  from an empty directory that passes `plugins conformance`).

  A version bump also regenerates [TOOL_REFERENCE.md](TOOL_REFERENCE.md):
  `check-tool-reference.sh` compares the version the generator stamped into the
  header with the binary's, so a snapshot from an older build fails CI instead of
  shipping as if it were current.
- [x] **Support policy** in SECURITY.md: previous two minors, twelve months from a
  release.

*Acceptance:* a clean container installs from the package, upgrades, and rolls
back without losing the keystore or the audit trail; every README claim links to
a test, a CI job, or a command.

## v1.0 — Freeze

Cut once the two quiet minors are behind it.

**Where the count stands.** ADR 0006 counts *releases*, not commits. The ladder
above was built in-tree across 0.4–0.7 and shipped as a single **0.7.0**.

**0.8 restarts the count** (ADR 0008): it removes the plugin protocol, the HTTP
API, the API token, and the `[plugins]`/`[api]`/`[trust]` config sections, and
adds the engine protocol. A removal resets the counter, so the ladder starts
again from the 0.8 release:

| Quiet release | Status |
|---|---|
| 0.7.0 (surface work done, nothing versioned moved) | released |
| 0.8.0 (the restructure; surfaces deliberately moved) | released — the reset |
| 0.9.0 (audits and ergonomics; nothing versioned moved) | released — the first quiet minor |
| 0.9.1 (the correction pass; a patch, not a quiet minor) | released |
| 0.10.0 (the enforcement pass: arguments, capabilities, schemas, the keystore) | released — the second quiet minor |
| 1.0.0 (the freeze; nothing versioned moved) | released — the promise |

**Gate status (2026-10-29).** `scripts/check-release-gates.sh` reports every
ADR 0006 gate satisfied: **0 broken, 0 open**. The countdown the ADR counts is
complete — 0.9.0 and 0.10.0 both moved no versioned surface — so 1.0.0 is cut
from the commit after 0.10.0.

> The quiet-period script counts *tags*, so it reports 0.8.0→0.9.0 and
> 0.9.0→0.9.1 as two quiet stretches. ADR 0006 counts *minor releases*. The
> stricter reading is the one this plan keeps: a patch is not a minor, so
> 0.10.0 is still required.

1.0 is therefore at least two quiet minors after 0.8.0, and
`scripts/check-quiet-period.sh` is what proves each one. It carries the restart
release, so it reported "not enforcing yet" until v0.8.0 was tagged and enforces
from there — no standing waiver, and nothing to remember to switch on.

- [x] **No unverified claims** — `scripts/check-readme-claims.sh` runs the front
  page as written (16 commands, all green) and lists the claims a command cannot
  settle with where their evidence lives. New `claims` CI job.
- [x] **Surfaces documented as public** — `docs/COMPATIBILITY.md` lists the
  CLI's commands and flags alongside the frozen types, and
  `scripts/check-public-surface.sh` compares that table with the surface the CLI
  declares (`packages/cli/src/surface.ts`), so a new flag fails CI until it is
  documented. Runs in the `docs` job.
- [x] Release artifacts: CLI archives for Linux (x86_64, aarch64), macOS
  (x86_64, aarch64), and Windows (x86_64), each carrying the engine packages;
  `.deb`/`.AppImage`, `.dmg`, and NSIS installers for the desktop app;
  checksums. `.github/workflows/release.yml`
  builds and attaches them from a tag, and publishes nothing unless every build
  succeeds.
- [x] **A `.gimlet` a second implementation can read** —
  `packages/engine/test/fixtures/read_container.py` is a Python reader written
  from `docs/CONTAINER.md` alone; it opens a multi-chunk file this build writes
  and reports the header it read. It moved with the Rust retirement and its
  guarantee did not: the `typescript` job now installs its KDF and sets
  `GIMLET_REQUIRE_SECOND_IMPL=1`, so a missing interpreter fails the test instead
  of skipping it. A test that skips is not evidence.
- [x] **The gates are one command, not a memory test** —
  `scripts/check-release-gates.sh` (`make gates`) prints every ADR 0006 gate with
  three states: `ok` (verified just now), `ci` (verified by the newest green run
  on main, read through `gh`), and `open` (with the reason — elapsed time, or a
  human). A gate whose evidence cannot be produced counts as a failure, so a row
  cannot look green while proving nothing. The soak is added up by
  `scripts/check-fuzz-soak.sh` (`make soak` records an entry); it sums
  `fuzz/soak-ledger.jsonl`, which is why the 350-target-minute branch of Gate 2
  is the one the audit below uses. The nightly schedule still runs: it is what
  notices a soak that stopped building.
- [x] **Gate 1 audit** (2026-10-26) — **superseded, kept as the record.** ADR 0008
  and ADR 0011 removed the plugin protocol, the HTTP API, and the Rust tree this
  table audits, so it describes a product that no longer exists. The audit of the
  tree 1.0 is cut from is directly below. Original finding: every ✅ in the README
  status table was backed by a test or a CI job that fails when it breaks:

  | Claim | Evidence |
  |---|---|
  | `Report`, registry, config, audit trail | 54 tests in `gimlet-eye-core`; `tests/data_shape.rs` holds every native tool to the documented shape |
  | Plugin protocol and host | protocol conformance runner; the `integration` job runs a real Perl pack |
  | CLI commands | `check-public-surface.sh` (documented) + `check-readme-claims.sh` (16 commands executed) |
  | HTTP API, UI, desktop shell | `smoke.sh` now calls all seven routes; `e2e` job runs Playwright against a live engine; `desktop` job typechecks the shell |
  | `sysadmin.*` | 16 tests in `gimlet-eye-sysadmin` |
  | `crypto.passgen`, `crypto.sha256` | `gimlet-eye-crypto` unit tests |
  | `privacy.metadata-*` for JPEG/PNG/WebP | golden corpus (4 tests) + 59 tests in `gimlet-eye-scrub` |
  | Profiles, field-level control, GPS redaction | `scrub::format` and `scrub::exif` tests |
  | Container v2, AEAD, Argon2id, Ed25519 | container tests, the v1/v3 fixtures, and the Python reader |
  | Keystore, X25519 recipients in v3 | 7 keystore tests, the v3 fixture opened by both implementations |
  | OpenPGP interop | `gpg_interop` against a real `gpg`, which now fails rather than skips in CI |

  One manifest claim needed a caveat rather than a tick:
  `perlden.ssl-checker` could not load without `IO::Socket::SSL`, which the pack's
  requirements did not mention. It was documented there, and the reference listed
  it under "did not run here" instead of implying it worked everywhere. (The pack
  protocol is gone; the lesson — a tool either runs or says why — is not.)
- [x] **Gate 1 audit, on the tree 1.0 is cut from** (2026-10-29) — every
  capability the README names, and every one the gates name, with the check that
  fails when it breaks:

  | Claim | Evidence |
  |---|---|
  | The report contract | `contract-schema.test.ts` compiles the published schemas and holds a golden report, every manifest, and the shapes the contract excludes to them; `runtime-verdict.test.ts` proves a tool cannot report success over a high finding |
  | `Report`, registry, config, audit trail | 509 tests over 43 files at this date (`make check`); `check-data-schema.sh` holds 21 tools to exactly the fields they declare |
  | The catalogue: 26 tools (crypto 15, privacy 3, sysadmin 8) | `check-tool-reference.sh` (26 covered, real output from a throwaway home) + `check-readme-claims.sh` (16 front-page commands executed) |
  | CLI surface | `check-public-surface.sh`: 35 commands and flags documented, compared with what the parser declares |
  | Desktop app | `e2e` drives the real Electron window (7 steps, no non-local request); `hardening.test.ts` asserts the CSP; `workbench.test.ts` the form, the masking, and the copyable command |
  | Container v1, v2, v3 | engine fixtures plus the Python second implementation, required in CI |
  | Keystore and X25519 recipients | `keystore-tools.test.ts` (pre-rename store, 0600 on create, the conflict rule), the v3 fixture |
  | Metadata removal for JPEG, PNG, WebP | the committed corpus, the no-growth and idempotence property tests, the soak |
  | OpenPGP interop | `gpg.test.ts` against a real `gpg` |
  | Declared capabilities | `capabilities.test.ts`: a write or an `exec` not declared fails with `capability_denied` |
  | Platform contract | `platform-contract.test.ts`: every tool that names one platform refuses the others with `unsupported` before it reads anything |

  One row of ADR 0006 is **not** claimed and does not need to be: "secrets are
  zeroized on drop". They are not, and SECURITY.md says so in the cryptographic
  posture rather than the docs implying otherwise — the ADR's own rule is that a
  smaller 1.0 beats an overstated one.
- [x] **Gate 2 audit** (2026-10-29) — `scripts/check-fuzz-soak.sh` reports
  **361.2 target-minutes over six targets** (container, exif, gps, jpeg, png,
  webp), 2,394,505,047 inputs, no crashes. The 2026-10-26 amendment accepts 350
  target-minutes *or* seven scheduled nights, and the ledger is a committed file,
  so the evidence is in the repository rather than in a job's memory. The
  API-token, pack-trust, and MSRV rows left with the surfaces they protected
  (ADR 0008, 0010, 0011); what replaces them is the `dependency policy` job
  (`npm audit --omit=dev` over the shipped set), the Node 20 floor enforced by
  `debian/control` and the rehearsal, and the `e2e` job for the row that asked
  for a live-UI pass.

  > **Erratum.** This checklist and the 2026-10-26 amendment both named
  > `check-fuzz-nights.sh` / `make fuzz-nights`. No such script exists, and none
  > did: the script that reports the number is `scripts/check-fuzz-soak.sh`
  > (`make soak` records an entry). Corrected here rather than in the amendment,
  > which is a dated record of what was decided at the time.
- [x] **Gate 3 audit** (2026-10-29) — the surfaces are named and versioned in
  [COMPATIBILITY.md](COMPATIBILITY.md), which also lists the CLI's commands and
  flags; `check-quiet-period.sh` reports no versioned surface moved since v0.8.0,
  and carries that restart release itself so nothing has to be remembered; the
  one-minor deprecation rule and the two-minor, twelve-month support window are
  written in COMPATIBILITY.md and SECURITY.md; `check-public-surface.sh` keeps the
  documentation and the binary in step. The HTTP API and plugin protocol rows are
  struck out in ADR 0006 rather than silently dropped.
- [x] **Gate 4 audit** (2026-10-29) — the key the 2026-10-26 entry was waiting for
  exists: `release-key.pub` is committed, `MINISIGN_SECRET_KEY` is set, and v0.9.1
  published a `SHA256SUMS` with a `SHA256SUMS.minisig` that the `publish` job
  verifies with `minisign -V` and `scripts/verify-release.sh` re-checks. The
  `reproducible` job rebuilds the tag in a second directory and refuses to
  publish when the digests differ. The SBOM the ADR asks for is generated from the
  lockfile by the `sbom` job and attached with the rest, so it is checksummed and
  signed too. Packaging: Arch, Fedora, and Debian recipes all stage through
  `scripts/stage-package.sh`, and `rehearsal` installs a `.deb`, upgrades it, and
  rolls back with a keystore and an audit trail in place. `cargo install` retired
  with the Rust tree; the documented install paths are the packages and the CLI
  archives, in [ADMIN_GUIDE.md](ADMIN_GUIDE.md).
- [x] **Every tool has an example with real output** —
  `docs/TOOL_REFERENCE.md` covers all 26 tools, generated by
  `scripts/tool-reference.py`, which runs each one in a throwaway home and pastes
  what it printed. `scripts/check-tool-reference.sh` fails when a tool exists that
  the reference does not show, so the coverage cannot rot.
- [x] **Gate 5 audit** (2026-10-29) — the user guide and the admin guide are
  published; every README claim is executed by `check-readme-claims.sh`; all 26
  tools have an example with real output in [TOOL_REFERENCE.md](TOOL_REFERENCE.md),
  enforced by `check-tool-reference.sh`; and the report and manifest contracts are
  published as JSON Schema with the reasoning in ADR 0012. The pack gallery is
  superseded by ADR 0008 — there is no pack protocol, and adding a tool is
  documented in ARCHITECTURE.md §8.
- [x] ADR 0006 is **Accepted** (2026-10-25) and this checklist is its 1.0 audit;
  its two amendments are dated and the errata above are recorded next to the rows
  they correct.
- [x] `CHANGELOG.md` gets a 1.0.0 entry stating the promise in one paragraph.

*Acceptance:* every checkbox in ADR 0006 is green, and
`scripts/check-quiet-period.sh` reports no versioned surface moved in the two
stretches ADR 0006 counts (v0.8.0 → v0.9.0 and v0.9.0 → v0.10.0) or in this
build.

## After 1.0

Deferred deliberately: none of it blocks the freeze, and each can ship in a 1.x
minor without a breaking change.

- Native ports of `FailedLoginDetector`, `FilePermissions`, `UserAudit` — the
  pack already serves them behind the same manifest.
- `automation` module: scheduled runs, dry-run default, cron or systemd backend.
- A browser-safe subset of `packages/engine` for a web build (scan/strip, hash,
  passgen); the barrel is already free of `node:*`, so the work is the primitives.
- ~~TUI (`gimlet tui`) for terminals~~ — shipped.
- Windows and macOS parity for the `/proc`- and `df`-based sysadmin tools.
- Random access into a large `.gimlet` container (today a seek means decrypting
  from the start).

## Explicitly out of scope

- Becoming an IDE. Perl Den's editor, terminal, and tutorials stay in Perl Den.
- A hosted/cloud service. Everything is local by design.
- Reimplementing cryptographic primitives. The toolkit wraps audited
  implementations; it does not invent them.
