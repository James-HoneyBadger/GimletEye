# Architecture

The goal is a toolkit that is easy to extend and cheap to maintain across three
domains and more than one implementation language. This document explains the
structure, the rules that keep it from decaying, and the reasoning behind each
choice.

- [1. Design goals](#1-design-goals)
- [2. Domain pillars](#2-domain-pillars)
- [3. Layers and dependency rules](#3-layers-and-dependency-rules)
- [4. The tool contract](#4-the-tool-contract)
- [5. Surfaces](#5-surfaces)
- [6. Configuration and state](#6-configuration-and-state)
- [7. Security model](#7-security-model)
- [8. Extending: modules vs packs](#8-extending-modules-vs-packs)
- [9. Testing strategy](#9-testing-strategy)
- [10. Build, CI, and release](#10-build-ci-and-release)
- [11. Module status](#11-module-status)
- [12. Known limitations](#12-known-limitations)

---

## 1. Design goals

1. **One contract, many surfaces.** A capability is implemented once and exposed
   to the CLI, HTTP API, desktop shell, and future WASM target without
   duplication.
2. **Modules are additive.** Adding a domain never edits another module, a
   handler, or a view. One line in the composition root.
3. **Nothing is stranded by a language choice.** Existing Perl and TypeScript
   code can participate through a documented protocol while its native port is
   pending — or indefinitely, if porting is not worth it.
4. **Boring, verifiable infrastructure.** Standard cargo workspace, standard CI,
   no bespoke build system, no code generation in the critical path.
5. **Privacy and security are structural.** Capabilities are declared and
   enforced, audit records never contain secrets, and metadata removal is
   verified before it is written.

## 2. Domain pillars

The toolkit covers three domains that share the same shape — inspect or change
something on this machine, then explain what happened:

| Pillar | Questions it answers | Module |
|---|---|---|
| **System** | What is this host doing? What is filling the disk? Which service is failing? | `mellivora-sysadmin` |
| **Crypto** | Is this secret protected? Who signed this? Where are my keys? | `mellivora-crypto` |
| **Privacy** | What does this file reveal about me? How do I remove it without breaking the file? | `mellivora-scrub` |
| **Automation** *(planned)* | Run those checks on a schedule and report drift. | `mellivora-automation` |

Three properties cut across all of them, and they are what the architecture
optimises for:

1. **A result must be explainable.** Every run produces findings with a
   severity, so "did it pass?" is never a matter of reading prose.
2. **A change must be reversible or provably safe.** Mutating tools honour
   `--dry-run`, verify their own output, and never re-encode image data.
3. **Nothing leaves the machine.** No telemetry, no network calls unless a tool
   declares `network` and the user grants it.

The design pressures that follow are concrete:

- An operation needs to be reachable from a terminal, a script, a browser, and a
  desktop window without being written four times.
- Security-sensitive code should not depend on a runtime chosen for convenience.
- The set of supported file formats and host checks will keep growing, so adding
  one must not mean editing a handler or a view.
- Some capabilities are better served by an existing implementation in another
  language, and waiting for a rewrite would strand them.

The rest of this document is the answer to those pressures: one contract, thin
surfaces, modules that add themselves, and a process boundary for anything that
cannot be written in Rust today.

## 3. Layers and dependency rules

```
┌──────────────────────────────────────────────────────────────┐
│ surfaces        crates/cli, apps/desktop, packages/ui,       │
│                 crates/wasm (planned)                        │
└───────────────────────────┬──────────────────────────────────┘
                            │ may depend on: composition only
┌───────────────────────────┴──────────────────────────────────┐
│ composition     crates/toolkit, crates/server                │
│                 registry wiring · runtime · serve helpers    │
└───────────────────────────┬──────────────────────────────────┘
                            │ may depend on: core + modules
┌───────────────────────────┴──────────────────────────────────┐
│ modules         crates/sysadmin, crates/crypto, crates/scrub │
│                 (+ packs: plugins/*)                         │
└───────────────────────────┬──────────────────────────────────┘
                            │ may depend on: core only
┌───────────────────────────┴──────────────────────────────────┐
│ core            crates/core                                  │
│                 Tool · Report · Registry · Config · Audit    │
│                 Capabilities · Plugin host · Paths           │
└──────────────────────────────────────────────────────────────┘
```

Rules, enforced by review and by `cargo` itself:

1. **`mellivora-core` depends on no domain crate.** It knows what a `Tool` is,
   not what a password is. This is why config uses namespaced `modules` keys
   instead of typed fields per domain.
2. **Modules never depend on each other.** If two modules need the same thing,
   it belongs in core.
3. **Surfaces contain no logic.** A surface resolves a tool, runs it, and
   renders a `Report`. `crates/server` is ~250 lines for that reason.
4. **Packs are processes, not libraries.** They cannot see the host's memory,
   so a pack bug cannot corrupt the engine. The protocol is the whole interface.
5. **`crates/toolkit` is the composition root.** It is the only crate that
   knows the list of modules, and the only one that knows how to assemble a
   `Runtime`:

```rust
registry.register_all(mellivora_sysadmin::tools()?)?;
registry.register_all(mellivora_crypto::tools()?)?;
registry.register_all(mellivora_scrub::tools()?)?;
```

Adding a module is one line. Adding a surface never touches a module: the CLI
and the desktop shell both go through `Runtime`, so they see the same tools,
the same configuration, and the same audit trail by construction. A surface
that assembled its own registry could drift; this one cannot.

### Why a workspace rather than one crate

- Compile isolation: changing `scrub` does not rebuild `crypto`.
- Boundary enforcement: a dependency that should not exist fails to compile.
- Test scoping: `cargo test -p mellivora-scrub` runs in seconds.

### Why not a single binary crate with feature flags

Feature flags create combinatorial test matrices and let surfaces compile
against dormant code. Separate crates make the dependency direction explicit and
keep `--no-default-features` surprises out of CI.

## 4. The tool contract

Everything is a `Tool`:

```rust
pub trait Tool: Send + Sync {
    fn manifest(&self) -> &ToolManifest;
    fn run(&self, ctx: &ToolContext, args: &Args) -> Result<Report>;
}
```

`ToolManifest` is the machine-readable description used by the CLI, the UI form
renderer, and the plugin listing:

```toml
id          = "sysadmin.disk-usage"
title       = "Disk usage"
category    = "sysadmin"
capabilities = ["system", "process:exec"]
args        = [{ name = "path", type = "path" }, { name = "all", type = "boolean", default = false }]
origin      = "builtin"          # or "plugin:<pack-name>"
```

`Report` is the single result shape:

```rust
Report {
    tool: String,
    status: Status,              // ok | warning | error
    summary: String,             // one line, always present
    findings: Vec<Finding>,      // severity + code + message + target
    data: serde_json::Value,     // structured, for machines
    body: Option<String>,        // human text from compat packs
    warnings: Vec<String>,       // non-fatal problems
    duration_ms: u64,
}
```

Two details matter:

- **`status` is derived, not asserted.** `Report::sealed()` computes it from
  findings, so a tool cannot report `ok` while emitting a `high` finding.
- **`data` is the machine channel, `body` is the human channel.** This is what
  lets a Perl module return its formatted box-drawing report *and* structured
  data from the same call, without either surface having to parse the other.

`ToolContext` carries everything ambient, so tools are pure functions of
`(ctx, args)` and trivially testable:

```rust
ToolContext { paths, config, dry_run, granted: CapabilitySet }
```

### Arguments

`Args` is a typed wrapper over a JSON object. The CLI passes `key=value` pairs,
the API passes JSON, and packs receive the same object. Coercion of
`true`/`false`/integers keeps the CLI ergonomic without a second parser.

### Resolution

`Registry::resolve` accepts an exact id, a `category.tool` id, or a unique
suffix, with trigram-similarity suggestions on failure (carried over from Perl
Den's fuzzy `find_closest`). When a shorthand is ambiguous, **a built-in always
wins over a pack** — a pack must not be able to silently take over
`system-info`.

## 5. Surfaces

| Surface | Crate | Responsibility |
|---|---|---|
| `mellivora` CLI | `crates/cli` | parse, resolve, run, render, audit |
| Composition root | `crates/toolkit` | wire modules into a `Runtime`, serve it |
| HTTP API | `crates/server` | resolve, run, serialize |
| Desktop | `apps/desktop` | window, embedded engine, port hand-off |
| Web UI | `packages/ui` | render manifests, forms, and reports (no tool-specific code) |
| WASM (planned) | `crates/wasm` | run pure tools in-browser |

The desktop shell is self-contained. It binds a loopback port, starts the same
`Runtime` the CLI uses on a background thread, and hands the port to the window
through an initialization script (`window.__MELLIVORA_API__`). There is no
second process to start and no port to configure; `mellivora serve` remains for
browser and LAN use.

The HTTP API is intentionally boring:

```
GET  /api/v1/health          → status, version, tool/pack counts
GET  /api/v1/tools           → [ToolManifest]
GET  /api/v1/tools/{id}      → ToolManifest
POST /api/v1/run             → { tool, args, dry_run } → Report
GET  /api/v1/packs           → [PackSummary]
GET  /api/v1/config          → effective config (no secrets)
```

Blocking work runs on `spawn_blocking`; the API binds to loopback by default
and allows any origin because the desktop window, the Vite dev server, and the
`file://`-style webview origin are all different origins. If it is ever exposed
beyond loopback, add authentication *before* changing the bind address — see
[Security](#7-security-model).

The UI renders forms from `ToolManifest.args`, so a new tool appears in the UI
with no frontend change. That is the payoff of the manifest contract — and the
reason argument specs are flattened on the wire (`{"name": "path", "type":
"path"}`) rather than nested.

The UI is organised as a small design system plus components:

```
packages/ui/src/
├── lib/          api client, state, formatting, data rendering
├── components/   topbar, sidebar, workbench, result, icons
├── styles/       design tokens + layout
└── main.ts       boot and event wiring
```

Results are rendered from `Report`, not from tool names: findings become a
severity-ordered list, `body` becomes a monospace report, and `data` is shaped
into tables for arrays of objects, key/value lists for scalars, and nested
sections for the rest. Raw JSON is always one click away.

## 6. Configuration and state

One TOML file, one state root:

```
$MELLIVORA_HOME (default: ~/.config/mellivora)
├── config.toml
├── audit.jsonl
├── data/
├── cache/
└── plugins/          # drop-in packs
```

```toml
schema_version = 1

[defaults]
output = "text"
dry_run = false

[plugins]
dirs = []
disabled = ["experimental"]
timeout_ms = 30000        # host default; packs may override
allow = []                    # empty = grant what packs declare

[audit]
enabled = true
max_entries = 1000

[modules.sysadmin]            # owned by the sysadmin crate
disk_warn_percent = 80
disk_critical_percent = 92
memory_warn_percent = 90
load_warn_per_core = 2.0
```

`modules` is untyped on purpose: a module reads its own namespace
(`ctx.config.module("sysadmin")`), so adding a domain never edits core. Schema
version is checked on load and a newer schema is rejected rather than
misinterpreted.

**Audit** is append-only JSON Lines. It records tool, status, duration, and
argument *names* — never values, because values contain passwords and paths that
may be sensitive. The rule is enforced by a test, so it cannot regress.

## 7. Security model

The toolkit runs everything locally and holds secrets. Four structural choices:

1. **Capabilities are declared and checked.** Tools declare `fs:read`,
   `fs:write`, `process:exec`, `network`, `secrets`, `system`. Built-ins check
   their own required capability at entry; the plugin host refuses to dispatch a
   pack tool whose declared capabilities were not granted.
2. **Packs are separate processes.** No shared address space, no link-time
   access to the crypto code. A pack can be killed on timeout.
3. **Audit never stores values** (see above).
4. **Removal is verified before write.** `privacy.metadata-strip` re-scans its
   own output and errors if metadata remains; it does not write a partial strip.
   The re-scan happens even in `--dry-run` so the failure is found early.

Additional invariants worth preserving:

- `--dry-run` is honoured by every mutating tool and is visible in the report.
- Plugin commands are `argv` arrays in the manifest, never shell strings, so a
  manifest cannot inject shell syntax.
- Static UI serving rejects `..` traversal.
- Crypto tooling relies on the OS CSPRNG; password generation uses rejection
  sampling to avoid modulo bias.

See [SECURITY.md](../SECURITY.md) for the threat model and reporting process.

## 8. Extending: modules vs packs

Choose a **module** (Rust) when the code is performance- or security-critical,
needs to be in-process (crypto, streaming), or must ship to WASM.

Choose a **pack** when the implementation already exists in another language,
needs that runtime (Node for HEIC/PDF/MP4 parsing, Perl for the sysadmin
catalogue), or is third-party.

Porting path: start as a pack, measure, port the hot or security-critical parts,
keep the pack until the port reaches parity, then remove it. Both expose the
same `ToolManifest`, so nothing downstream notices the switch.

The full protocol is in [PLUGIN_SDK.md](PLUGIN_SDK.md).

## 9. Testing strategy

| Layer | What is tested | How |
|---|---|---|
| Parsers | `/proc`, `df`, JPEG/PNG/WebP structures | pure functions over fixtures — no I/O |
| Tools | behaviour, findings, status, dry-run | `ToolContext` with a temp `AppPaths` |
| Contracts | report round-trip, status derivation, registry resolution, capability denial | unit tests in `core` |
| Protocol | manifest validation, discovery, broken packs, encoding | unit tests + live pack run |
| Surfaces | CLI arg rewriting, HTTP handlers | unit tests; `curl` in the smoke script |
| End-to-end | Perl Den module through the pack | `scripts/smoke.sh` |

Rules that keep this cheap:

- **Parsers are separate from I/O.** The `parse.rs` in `mellivora-sysadmin` has
  no filesystem access, so every branch is testable with a string. The EXIF
  reader in `crates/scrub/src/exif.rs` works the same way: it takes a byte slice
  and a shared fixture builder produces valid structures for tests.
- **Tools take `ToolContext`.** No globals, no `std::env::set_var` in tests.
- **Tests never depend on host state** where avoidable; where they must (real
  `df`), they assert shape rather than exact values.
- **Golden behaviour lives in the contract.** If a tool wants to say "error", it
  must emit a `high` finding — the test asserts that, not a string.

## 10. Build, CI, and release

- **Toolchain pinned** in `rust-toolchain.toml`; MSRV 1.82 in
  `[workspace.package]`.
- **Workspace lints** deny `unsafe_code` and warn on `dbg!`/`todo!`, so those
  cannot pass review silently.
- **CI** (`.github/workflows/ci.yml`) runs: `fmt --check`, `clippy -D warnings`,
  `test --workspace`, UI type-check + build, the Perl pack syntax check, and a
  live end-to-end slice with a shallow Perl Den clone.
- **Versioning**: workspace version in one place; modules are versioned
  together until they have independent consumers. `Report` and the plugin
  protocol carry explicit versions because they are the public API.
- **Release**: build the CLI + server binaries per target, the UI bundle, and
  the Tauri installers. Pack manifests are released separately so packs can
  update without a toolkit release.
- **Dependency policy**: `deny.toml` allows MIT/Apache-2.0/BSD; new crypto
  dependencies need an ADR.

## 11. Module status

Where each pillar stands, in the toolkit's own terms. The roadmap carries the
acceptance criteria; this is the honest inventory.

### System — `mellivora-sysadmin`

| Capability | Status |
|---|---|
| Host inventory (kernel, uptime, load, CPU, memory) | native |
| Filesystem utilisation with configurable thresholds | native |
| Log, auth, permission, package, and service audits | available through a compatibility pack; native ports planned |
| Scheduled runs and drift detection | planned |

Read-only checks land first; anything that mutates state needs `--dry-run` and a
test before it ships. Thresholds live in the `modules.sysadmin` config namespace.

### Crypto — `mellivora-crypto`

| Capability | Status |
|---|---|
| OS randomness, SHA-256, password generation | native |
| Authenticated encryption (AES-256-GCM, ChaCha20-Poly1305) + Argon2id | native, `.melv` container v1 |
| Signatures (Ed25519) | native |
| Streaming encryption, keystore, X25519/RSA/OpenPGP, Shamir, shredding, QR | planned |

`CryptoBackend` is the seam: adopting each capability is an implementation of
one trait, not a change to any tool or surface. The container format is
specified in [CONTAINER.md](CONTAINER.md) and versioned like any other public
API.

### Privacy — `mellivora-scrub`

| Capability | Status |
|---|---|
| Metadata scan, strip, verify | native for JPEG, PNG, WebP |
| Removal profiles and field-level `keep`/`remove` | native |
| GPS redaction (coordinate truncation, EXIF preserved) | native |
| HEIC, AVIF, TIFF, PDF, MP4, RAW, GIF, SVG | planned; packs can serve them meanwhile |
| Metadata injection, streaming strip | planned |

Removal is byte-level: pixel data is never re-encoded, and a strip is re-scanned
before it is written.

### Compatibility packs

A pack is an optional adapter for a capability that another implementation
already covers. Packs are discovered, capability-gated, and indistinguishable
from native tools at the registry — a built-in always wins an ambiguous
shorthand, so installing a pack can never silently replace trusted behaviour.
The provenance of any adapter is recorded in
[PROVENANCE.md](PROVENANCE.md), and the protocol is specified in
[PLUGIN_SDK.md](PLUGIN_SDK.md).

## 12. Known limitations

Stated plainly, because a design document that hides them is not useful:

1. **No keystore, no asymmetric encryption.** Files are encrypted with a
   passphrase; Ed25519 signs but cannot encrypt, and there is no keyring,
   X25519 exchange, or OpenPGP interop yet.
2. **Three of thirteen metadata formats are native.** The rest return a clear
   `unsupported` error that names the pack to install — not a silent success.
   GPS redaction is likewise limited to those three containers.
3. **The Perl pack is synchronous.** One request at a time per pack; fine for
   interactive use, a limitation for bulk runs.
4. **No scheduler or TUI yet.** Perl Den's crontab integration is not ported;
   cron remains the supported way to schedule.
5. **The desktop shell embeds the engine but exposes no native menu or file
   dialogs.** Everything is driven from the shared web UI, so a "choose a
   file" button would need a Tauri command — deliberately deferred until the
   UI needs it.
6. **`crates/server` has no authentication.** It must stay on loopback until it
   does. The desktop shell binds an ephemeral loopback port for exactly this
   reason.
