# Architecture

Two programs ship — a desktop app and a command line — and they share one
implementation of everything that decides what a run means. The parts that touch
key material or parse a file format live in one engine package that both of them
import.

- [1. Design goals](#1-design-goals)
- [2. The four layers](#2-the-four-layers)
- [3. The tool contract](#3-the-tool-contract)
- [4. Why there is one implementation](#4-why-there-is-one-implementation)
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
   exist once, beside the fixtures, the corpus, and the second implementation that
   earned the current confidence.
3. **No server.** The desktop app does not listen on a port, does not carry a
   token, and cannot be driven by a web page.
4. **Boring, verifiable infrastructure.** Standard npm workspace, no bespoke
   build system, no code generation in the critical path.
5. **Privacy and security are structural.** Nothing opens a socket, the audit
   trail cannot contain values, and metadata removal is verified before it is
   written.

## 2. The layers

```
┌──────────────────────────────────────────────────────────────┐
│ surfaces        packages/cli (Node) · apps/desktop (Electron) │
└───────────────────────────┬──────────────────────────────────┘
                            │ imports, not RPC
┌───────────────────────────┴──────────────────────────────────┐
│ core            packages/core: catalogue · report · args      │
│                 config · audit · paths · the tools themselves │
└───────────────────────────┬──────────────────────────────────┘
                            │ imports
┌───────────────────────────┴──────────────────────────────────┐
│ engine          packages/engine: container · keys · keystore  │
│                 signing · passgen · metadata scrub            │
└──────────────────────────────────────────────────────────────┘
```

The dependency rules are one-directional:

- the surfaces depend on `packages/core`, and on `packages/engine` only through
  the `@gimlet-eye/core/node` entry point;
- `packages/core`'s barrel stays browser-safe — no `node:*` — because the desktop
  UI imports it; anything that needs Node is a separate entry point;
- the engine depends on nothing in core and never on a surface, so it can be
  tested without either;
- `@noble/hashes` is the only runtime dependency, and only for Argon2id.

A few tools need no cryptographic care (`system-info`, `disk-usage`): they read
`/proc` and run `df`. Everything else — the
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
reports a high finding cannot also report success. Every tool — including the
engine's own — goes through it, and a surface never re-derives it.

Argument values are typed on arrival: `k=v` pairs, a form in the desktop app, and
the engine's JSON all become one `Args` bag, with only `true`/`false` and
canonical integers coerced. `0123`, `+5`, and `-0` stay strings, because
rewriting them would silently change a passphrase, a PIN, or a file name.

## 4. Why there is one implementation

`packages/engine` holds the parts where a mistake costs data: the container
format, key handling, signing, and the metadata scrub. Both surfaces import it,
so a behaviour cannot differ between them and there is no second process to keep
in step. [ADR 0010](adr/0010-retire-rust.md) records the migration that produced
this shape, and what it cost.

Three properties matter:

- **One writer, one reader.** The format is still defined by
  [CONTAINER.md](CONTAINER.md), and a Python reader written from that document
  alone is part of the test suite. A format only its own source can implement is
  not documented.
- **Not extensible.** The engine runs the tools this build compiled. There is no
  discovery of user-supplied executables, no manifest filename to place, and no
  code path that loads code the build did not produce. This is the one place the
  project deliberately gave up an extension point.
- **Bounded memory.** The chunked layout exists so a file need not fit in RAM:
  `crypto.encrypt` and `crypto.decrypt` pass the file through `ChunkSealer` and
  `ChunkOpener` a window at a time, holding one window and one chunk. On a 256 MiB
  input that is ~106 MiB of peak RSS; buffering the file whole was ~909 MiB. The
  reader and writer are one implementation each, and the whole-buffer entry points
  call them, so the two cannot drift.
- **An optional second opinion.** `GIMLET_SIDECAR` can still point at a separate
  engine, and it is used when one is present, but its absence is a supported
  state: every tool is built in. What it buys is an independent implementation to
  compare against, which is how the ports in ADR 0010 were checked.

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

**Desktop app.** `apps/desktop` is an Electron 45 window. The main process in
`apps/desktop/electron` holds the one `Runtime` and owns the operating-system
boundary; the renderer is a view that asks for a catalogue, a report, or the
audit tail over four fixed IPC channels exposed by the preload. It holds no
runtime and no key material, so a passphrase never enters a webview. There is no
HTTP server, no port, no token, and no way for a web page to drive the tools.

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

A tool that touches key material or a file format goes beside the primitives in
`packages/engine`, and is then wrapped by a `LocalTool` in
`packages/core/src/tools`:

1. The primitive lives in `packages/engine`, with no knowledge of reports or
   arguments, so it can be tested on bytes.
2. The tool builds the manifest, reads its arguments, and seals a report.
3. It must be listed in `NODE_TOOLS` in `packages/core/src/node.ts`; the
   registration guard test fails if it is not.
4. Add an example to `scripts/tool-reference.py` so the generated reference
   covers it, and a test at the level where the behaviour lives.

## 9. Testing strategy

| Layer | What is tested | How |
|---|---|---|
| Contracts | Report verdicts, argument coercion, resolution, config, paths, audit | `packages/core/test` (vitest, fake host) |
| CLI | Parsing, batch expansion, aggregate reports, declared surface | `packages/cli/test` |
| Desktop | Generated forms, validation, run flow, sheets, focus management | `apps/desktop/src/**/*.test.ts` (vitest + jsdom, mocked engine) |
| Engine | Tool behaviour, container versions, keystore, parsers | `packages/engine/test` (vitest) |
| Container format | A second implementation reads what this build writes | `packages/engine/test/fixtures/read_container.py` |
| Parser corpus | The inputs the Rust fuzz targets saved, replayed | `packages/engine/test/corpus.test.ts` |
| End to end | The CLI against real files | `scripts/smoke.sh` |
| Claims | Every README example, run as written | `scripts/check-readme-claims.sh` |
| The tests themselves | The code is broken on purpose; each break must fail a test | `scripts/mutation-check.sh` (`make mutation`) |

The seed corpus those fuzz targets saved now runs on every test pass, which keeps
their regression value even though the nightly soak did not survive the move. That
gap is recorded rather than glossed: ADR 0010 lists it as a cost.

## 10. Build, CI, and release

`make check` runs what CI runs: `tsc` over every package, `vitest`, and the
documentation gates.

A release publishes one thing: the CLI package tree and the desktop app, both
containing the same packages. There is no binary to publish alongside them, and
nothing that can be out of step.

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
