# Architecture

Two programs ship — a desktop app and a command line — and they share one
implementation of everything that decides what a run means. The parts that touch
key material or parse a file format live in one Rust engine that both of them
spawn.

- [1. Design goals](#1-design-goals)
- [2. The four layers](#2-the-four-layers)
- [3. The tool contract](#3-the-tool-contract)
- [4. The engine protocol](#4-the-engine-protocol)
- [5. Surfaces](#5-surfaces)
- [6. Configuration and state](#6-configuration-and-state)
- [7. Security model](#7-security-model)
- [8. Adding a tool](#8-adding-a-tool)
- [9. Testing strategy](#9-testing-strategy)
- [10. Build, CI, and release](#10-build-ci-and-release)
- [11. Known limitations](#11-known-limitations)

---

## 1. Design goals

1. **One implementation of the surface.** Tool resolution, report rendering,
   configuration parsing, and the audit trail exist once. Two surfaces, one
   behaviour.
2. **One implementation of the risky parts.** Cryptography and format parsing
   exist once, in a language with the fuzz corpora and fixtures that earned the
   current confidence.
3. **No server.** The desktop app does not listen on a port, does not carry a
   token, and cannot be driven by a web page.
4. **Boring, verifiable infrastructure.** Standard cargo workspace, standard npm
   workspace, no bespoke build system, no code generation in the critical path.
5. **Privacy and security are structural.** Nothing opens a socket, the audit
   trail cannot contain values, and metadata removal is verified before it is
   written.

## 2. The four layers

```
┌──────────────────────────────────────────────────────────────┐
│ surfaces        packages/cli (Node) · apps/desktop (Tauri)    │
└───────────────────────────┬──────────────────────────────────┘
                            │ imports, not RPC
┌───────────────────────────┴──────────────────────────────────┐
│ core            packages/core: catalogue · report · args      │
│                 config · audit · paths · sidecar client       │
└───────────────────────────┬──────────────────────────────────┘
                            │ one JSON line per request
┌───────────────────────────┴──────────────────────────────────┐
│ engine          crates/sidecar → crates/crypto, crates/scrub  │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────────────┐
│ contracts       crates/core: Report · ToolManifest · Args     │
└──────────────────────────────────────────────────────────────┘
```

The dependency rules are one-directional and checked by the build:

- the surfaces depend on `packages/core` and on nothing in `crates/`;
- `packages/core` depends on the engine only across the process boundary;
- the engine crates depend on `crates/core` and never on a surface;
- `crates/core` depends on nothing but `serde` and the standard library.

Two tools genuinely run in TypeScript (`system-info`, `disk-usage`): they read
`/proc` and run `df`, which needs no cryptographic care. Everything else — the
container format, the AEAD and KDF work, signing, the keystore, and the JPEG,
PNG, and WebP parsers — is in the engine, because that is where the evidence
lives.

## 3. The tool contract

A manifest says what a tool is; a report says what it found. Both are the same
shape whichever language produced them.

```jsonc
// manifest
{
  "id": "crypto.sha256",
  "title": "SHA-256",
  "summary": "Hash text or a file",
  "category": "crypto",
  "capabilities": ["fs:read"],
  "args": [{ "name": "text", "type": "string" }, { "name": "input", "type": "path" }],
  "mutates": false
}
```

```jsonc
// report
{ "tool": "crypto.sha256", "status": "ok", "summary": "sha256:2cf2…", "data": {}, "duration_ms": 1 }
```

`status` is derived, never declared: `sealed()` in `packages/core/src/report.ts`
turns findings into `ok` / `warning` / `error` by severity, so a tool that
reports a high finding cannot also report success. The same rule is implemented
once for the engine's own reports by `crates/core/src/report.rs` — the engine
sends a finished `Report`, and the surface never re-derives it.

Argument values are typed on arrival: `k=v` pairs, a form in the desktop app, and
the engine's JSON all become one `Args` bag, with only `true`/`false` and
canonical integers coerced. `0123`, `+5`, and `-0` stay strings, because
rewriting them would silently change a passphrase, a PIN, or a file name.

## 4. The engine protocol

One JSON object per line, in and out. A handshake, a catalogue, and runs:

```json
{"id": 1, "op": "handshake"}
{"id": 2, "op": "list"}
{"id": 3, "op": "run", "tool": "crypto.sha256", "args": {"text": "hello"}, "dry_run": false, "home": "/home/you/.config/gimlet"}
```

The engine answers with the same `id`, `ok`, and either the payload or an error:

```json
{"id": 3, "ok": false, "error": {"code": "invalid_args", "message": "invalid arguments: …"}}
```

Three properties matter:

- **Versioned.** `protocol_version` is checked on connect. A surface built
  against a different engine refuses it instead of guessing.
- **Not extensible.** The engine runs the tools it compiled. There is no
  discovery of user-supplied executables, no manifest filename to place, and no
  code path that loads a binary the build did not produce. This is the one place
  the project deliberately gave up an extension point.
- **Not a security boundary.** A pack used to be untrusted code; the engine is
  *our* code. It is a process boundary for language and packaging reasons, not a
  sandbox, and nothing in the security model depends on it.

## 5. Surfaces

**`gimlet` (CLI).** `packages/cli` parses arguments, loads a `Runtime`, renders a
report, and maps the verdict to an exit code (`0` ok, `1` error, `2` usage). It
owns no behaviour of its own: `run`, `batch`, `tools`, `config`, `audit`, and
`doctor` are all a few lines over `packages/core`.

**Terminal surface.** `gimlet tui` is a fourth surface over the same
`packages/core`: the catalogue, filtering, argument entry, and report rendering
live in `packages/cli/src/tui` as pure functions, with one thin session loop that
owns the TTY. It calls `Runtime.run` like the CLI does, so a run started in the
terminal lands in the audit trail. No behaviour is duplicated: the state machine
is tested without a TTY, and a frame is asserted against an explicit size.

**Web surface.** `--format html` renders any report as one self-contained
document: inline CSS, a `default-src 'none'` content policy, no script, and no
request of any kind. It is a *viewer*, not a driver — there is no served UI and
no listening port, which is why [0008](adr/0008-typescript-surfaces-rust-engine.md)
still holds.

**Desktop app.** `apps/desktop` is a Tauri 2 window. Its frontend imports
`packages/core` and holds one `Runtime`; the Rust shell in
`apps/desktop/src-tauri` owns exactly two things: the window, and the
operating-system boundary a webview cannot reach (file reads and writes, one
`exec`, and the engine process). The frontend reaches that boundary through
Tauri commands, so there is no HTTP server, no port, no token, and no way for a
web page to drive the tools.

The same TypeScript tests drive both: `packages/core` is tested against a fake
host, and the UI against a mocked engine module.

## 6. Configuration and state

One TOML file, one state root:

```
$GIMLET_HOME (default: ~/.config/gimlet)
├── config.toml
├── audit.jsonl
├── data/
├── cache/
└── plugins/          # unused since 0.8; kept so a backup restores cleanly
```

A home written before the rename, `~/.config/mellivora`, is used when
`~/.config/gimlet` does not exist, and a `keystore.melv` inside it is opened
where it is: renaming the project must not strand a keystore or an audit trail.

```toml
schema_version = 1

[defaults]
output = "text"
dry_run = false

[audit]
enabled = true
max_entries = 1000

[modules.sysadmin]
memory_warn_percent = 90
load_warn_per_core = 2.0
disk_warn_percent = 80
disk_critical_percent = 92
```

A configuration written by a newer build is refused (the schema version is
checked); one written by an older build loads, with any sections belonging to
surfaces that no longer exist ignored rather than rejected.

The audit trail records one JSON object per line: timestamp, tool id, verdict,
duration, and argument **names**. Values never appear. A failed run is recorded
too — repeated failures are exactly what a trail is for. Writes go through a
sibling temporary file and a rename, so two surfaces running at once cannot
interleave a partial line.

## 7. Security model

- **No network.** Nothing in the toolkit opens a socket. The only external
  process the tools run is `df` (disk-usage) and `gpg` (the OpenPGP interop
  tools), both named explicitly.
- **No listening surface.** With the HTTP API gone, there is no port to bind and
  no token to protect. The desktop app is reachable only through its own window.
- **Secrets stay out of reports and the trail.** Passphrases are read from an
  environment variable or a prompt; the audit records argument names only.
- **Authenticated before believed.** Containers are AEAD-sealed and the whole
  header is associated data, so a tampered cipher, KDF parameter, or salt fails
  instead of weakening the file. Metadata removal is verified before the file is
  written.
- **Bounded work from untrusted input.** KDF parameters in a hostile header are
  validated before key derivation, and `crypto.decrypt` refuses an expensive
  configuration unless the operator vouches for the file.

The threat model, and what is deliberately out of scope, is in
[SECURITY.md](../SECURITY.md).

## 8. Adding a tool

A tool that only inspects the host goes in TypeScript:

1. `packages/core/src/tools/<name>.ts` exports a `LocalTool` — a manifest and a
   `run(ctx, args)` that returns a report.
2. Register it in `Runtime.load` in `packages/core/src/runtime.ts`.
3. Both surfaces see it immediately: the desktop form is generated from the
   manifest, and the CLI resolves the id.

A tool that touches key material or a file format goes in the engine:

1. Implement `Tool` in `crates/crypto` or `crates/scrub`; add it to that crate's
   `tools()`.
2. Nothing else changes: the surface asks the engine for its catalogue at start,
   so a new engine tool appears in `gimlet tools list` and in the desktop sidebar
   without a frontend change.
3. Add an example to `scripts/tool-reference.py` so the generated reference
   covers it, and a test at the level where the behaviour lives.

## 9. Testing strategy

| Layer | What is tested | How |
|---|---|---|
| Contracts | Report verdicts, argument coercion, resolution, config, paths, audit | `packages/core/test` (vitest, fake host) |
| CLI | Parsing, batch expansion, aggregate reports, declared surface | `packages/cli/test` |
| Desktop | Generated forms, validation, run flow, sheets, focus management | `apps/desktop/src/**/*.test.ts` (vitest + jsdom, mocked engine) |
| Engine | Tool behaviour, container versions, keystore, parsers | `cargo test` |
| Container format | A second implementation reads what this build writes | `crates/crypto/tests/second_implementation.rs` + `interop/read_container.py` |
| End to end | The CLI against the real engine | `scripts/smoke.sh` |
| Claims | Every README example, run as written | `scripts/check-readme-claims.sh` |

The engine keeps its fuzz targets (`crates/crypto/fuzz`, `crates/scrub/fuzz`);
the TypeScript side is covered by tests rather than fuzzing, which is a
reasonable trade for code that parses no untrusted input.

## 10. Build, CI, and release

`make check` runs what CI runs: `cargo fmt --check`, `clippy -D warnings`,
`tsc` over all three TypeScript packages, `cargo test`, and `vitest`.

A release publishes the engine and the CLI together, because a CLI without its
engine can list the catalogue and nothing else. The desktop bundle embeds the
same engine.

## 11. Known limitations

- **The desktop app cannot be built here.** This environment has no
  webkit2gtk, so the shell and its IPC host are type-checked but never run;
  the bundle and its e2e coverage belong to CI.
- **Two engines on one machine.** A dev checkout and an installed app each build
  their own; they share a home, so the audit trail interleaves. That is why the
  trail is written through a rename.
- **Windows paths.** Path arithmetic in `packages/core` handles both separators,
  but only Linux has been exercised end to end.
- **No scheduler, no watch mode.** A run is a run.
