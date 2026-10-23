# Migration plan

How the three projects become one toolkit without a big-bang rewrite.

The strategy is **strangle, don't switch**: each source project keeps working
until its replacement is at parity, and the toolkit grows around it. Every phase
leaves a usable product.

```
Phase 0  Foundations      contracts, registry, config, audit, CLI, API, UI     [done]
Phase 1  Sysadmin parity  Perl Den usable through the toolkit                  [done]
Phase 2  Privacy parity   HB_Scrub formats and operations                      [in progress]
Phase 3  Crypto parity    DarkStar engine behind CryptoBackend                 [next]
Phase 4  Consolidation    retire duplicate surfaces, native ports, packaging
```

---

## Phase 0 — Foundations ✅

Delivered:

- `Report` / `Tool` / `ToolManifest` contracts; registry with built-in-wins resolution.
- Versioned config with module namespaces; audit trail that never stores values.
- Plugin protocol + host: timeouts, capability enforcement, failure isolation.
- CLI (`run`, `tools`, `plugins`, `config`, `audit`, `doctor`, `serve`), HTTP
  API, shared UI, Tauri shell.
- 75 tests; CI covering Rust, UI, and the live Perl slice.

Exit criteria met: `cargo test --workspace` green; `mellivora system-info` and
`mellivora perlden.system-info` both work; UI builds and serves.

## Phase 1 — Sysadmin parity ✅ (compatibility path)

**Approach: adapter first, port second.**

All 20 Perl Den modules are live through `perlden` pack. That is a supported
end state for modules that are not worth porting; the port order below is about
performance, portability, and testability, not purity.

Port order (by value ÷ risk):

| Order | Module | Why |
|---|---|---|
| 1 | `SystemInfo` ✅ | read-only, highest traffic, trivial to verify |
| 2 | `DiskUsage` ✅ | read-only, thresholds benefit from typed config |
| 3 | `FailedLoginDetector` | security-relevant; regex parsing deserves fixture tests |
| 4 | `FilePermissions`, `UserAudit` | security-relevant, read-only |
| 5 | `LogAnalyzer`, `ConfigDiff` | high value, pure parsing |
| 6 | `ServiceMonitor`, `SystemdAnalyzer` | needs `systemctl` output fixtures |
| 7 | `PortScanner`, `NetworkDiag`, `SSLChecker` | network capability; keep in pack until capability policy is enforced end to end |
| 8 | `BackupManager`, `CronManager`, `DockerMonitor` | mutating or environment-dependent; require `--dry-run` first |
| 9 | everything else | remain in the pack |

Rules for each port:

1. Extract parsing into pure functions with fixtures from `t/fixtures/`.
2. Preserve the existing test expectations; port the tests with the code.
3. Emit findings (severity + code) instead of printing warnings.
4. Keep the tool id `sysadmin.<name>` and *do not* remove the pack tool
   `perlden.<name>` in the same release — deprecate it one release later.

Perl Den's IDE, terminal, tutorials, and TUI are **not** part of the toolkit.
Perl Den remains a standalone application. If an editor is wanted later, it is a
new UI feature with its own ADR, not a port.

## Phase 2 — Privacy parity ⏳

Native today: JPEG, PNG, WebP scan/strip/verify (byte-preserving, no re-encode).

Next, in order:

1. **`hb-scrub` Node pack** for the remaining formats — HEIC, AVIF, TIFF, PDF,
   MP4/MOV, GIF, SVG, RAW. The pack shells out to the existing, tested
   implementation. This is one `mellivora-pack.toml` plus a small adapter and it
   buys ten formats immediately.
2. **Profiles** (`privacy`, `sharing`, `archive`) as `modules.privacy` config
   presets resolved by the strip tool.
3. **GPS redaction** — truncate instead of delete. Needs EXIF parsing; do it
   after TIFF/EXIF parsing lands natively (shared with TIFF support).
4. **Metadata injection** — last, because writing metadata is riskier than
   removing it and needs the EXIF writer.
5. **Streaming** — a `Read`/`Write` based path so multi-gigabyte files do not
   load into memory. The container formats cooperate: chunks can be copied
   without buffering whole files.

Parity checks between the pack and native implementations:

- same bytes removed on the same fixture,
- same verify verdict,
- same warnings for unsupported constructs,
- no re-encoding (pixel bytes identical).

## Phase 3 — Crypto parity ⏳

`mellivora-crypto` defines `CryptoBackend`:

```rust
fn name(&self) -> &'static str;
fn capabilities(&self) -> Vec<String>;
fn random_bytes(&self, len: usize) -> Vec<u8>;
fn sha256_hex(&self, data: &[u8]) -> String;
```

Adoption order (each step is additive; no tool or surface changes):

1. Add `darkstar` crate dependency (path dependency on
   `external/Zayfer_Vault/crates/core`, or a published crate).
2. Implement `CryptoBackend` for the DarkStar engine — hashing first, then
   `passgen` (so the current backend can be differentially tested).
3. Add `crypto.*` tools that need the engine: `encrypt`, `decrypt`, `sign`,
   `verify`, `keygen`.
4. Wire the keystore and HBZF container behind `crypto.vault-*` tools.
5. Move the audit sink to the core audit log (keep DarkStar's record shape as a
   superset).

Compatibility guarantees:

- HBZF files written by DarkStar 1.1.x must remain readable; a golden-file test
  from the original repo gates the port.
- Keep `hb_zayfer` and `HB_ZAYFER_*` identifiers working in the Python bindings.
- Do not ship two audit formats.

The PyO3 bindings stay published for Python users. The PySide6 GUI is retired
only after every workflow it offers exists in the shared UI.

## Phase 4 — Consolidation

1. Port the remaining high-value sysadmin modules; shrink the Perl pack to a
   compatibility shim or drop it.
2. Delete the Electron/Tauri legacy shells from HB_Scrub and the PySide6 shell
   from DarkStar once their users have a replacement.
3. Add `crates/wasm` for browser-only tools (metadata scan/strip on a local file,
   hashing, password generation) using the same `Tool` implementations.
4. Add batch execution and the scheduler (`automation` module) with dry-run as
   the default and cron as the backend.
5. Packaging: distro packages, a single AppImage, and `cargo install`.

---

## Compatibility and deprecation

| Surface | Policy |
|---|---|
| CLI tool ids | Stable. Renames need an alias for one minor release. |
| `Report` / protocol | Versioned. Breaking changes bump `protocol_version` and `schema_version`. |
| Config | `schema_version` checked on load; newer schemas rejected, older migrated. |
| Env vars | `MELLIVORA_*`; `MELLIVORA_PERLDEN_HOME` honoured by the pack. |
| Source repos | Not vendored. `scripts/link-sources.sh` fetches what a workflow needs; `external/` is gitignored. |

Deprecation pattern: mark the old tool in its manifest summary (`(deprecated;
use sysadmin.x)`), log a warning at run time, remove one minor release later.

## Rollback

Each phase is independently revertible because surfaces talk only to the
registry:

- A pack can be disabled (`plugins.disabled = ["perlden"]`) without code changes.
- A native tool can be dropped from its module's `tools()` while the pack tool
  of the same name remains — the built-in-wins rule simply stops applying.
- The DarkStar engine is behind a trait; falling back to `OsBackend` is one
  constructor change.

## Risks

| Risk | Mitigation |
|---|---|
| Crypto port introduces a format or behaviour regression | golden files from DarkStar 1.1.1; differential tests against the old CLI |
| A pack's stdout framing breaks after a runtime upgrade | capability + timeout isolation; `plugins doctor` in CI; noisy lines on stdout are skipped |
| Perl Den modules drift while still serving both apps | the pack loads them read-only; pin the checkout used by CI |
| Native port silently changes a threshold | port tests first, then code; thresholds move to config with defaults equal to the old constants |
| Scope creep into IDE features | IDE work is explicitly out of scope; it needs its own ADR |
