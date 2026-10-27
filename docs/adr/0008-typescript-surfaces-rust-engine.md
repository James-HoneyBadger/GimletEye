# 8. TypeScript surfaces over one Rust engine

Date: 2026-10-27

## Status

Accepted. Supersedes [0001](0001-rust-spine-with-polyglot-packs.md) (the pack
protocol) and the HTTP surface in [0003](0003-one-ui-for-all-surfaces.md).

## Context

The toolkit had five surfaces — CLI, HTTP API, browser UI, Tauri desktop shell,
and a planned WASM target — all fed by a Rust core, plus a pack protocol that let
code in any language join the catalogue over JSON-RPC.

Two things went wrong with that shape:

1. **The web surface cost more than it earned.** The local HTTP API needed a
   bearer token, a CORS policy, a loopback bind, and a desktop shell that served
   the bundle *from the API* because Android and Linux webviews refuse a
   cross-scheme fetch. Every one of those was a security decision made to support
   a browser nobody had asked for.
2. **Packs were an extension point in a security tool.** A pack was arbitrary
   executable code that declared capabilities, and the host then trusted the
   declaration. Pinning digests made that auditable, not safe.

At the same time the request was explicit: a desktop app and a command line, no
web interface, and far less Rust.

## Decision

- **The surfaces are TypeScript.** `packages/core` holds the catalogue, the
  report contract, argument coercion, configuration, the audit trail, and path
  resolution. `packages/cli` and `apps/desktop` are hosts over it. There is no
  HTTP server, no port, and no token.
- **The risky parts stay Rust**, in `crates/sidecar`, spawned by both surfaces
  over a versioned, line-delimited JSON protocol.
- **Packs are removed.** The engine runs only what the build compiled.

## Why the engine stays

Porting crypto and format parsing to TypeScript was the alternative. It was
rejected because the confidence in that code is not in its line count:

| Evidence | What it covers |
|---|---|
| `crates/crypto/fuzz`, `crates/scrub/fuzz` | Hostile headers, hostile EXIF, hostile chunks |
| `crates/crypto/tests/fixtures/*.melv` | Files written by 0.2.0 and 0.5.0, still opened today |
| `tests/interop/read_container.py` | A second implementation written from CONTAINER.md alone |
| `tests/gpg_interop.rs` | Real OpenPGP interoperability through the system `gpg` |

A TypeScript reimplementation would start at zero on all four and would put
AES-GCM, Argon2id, and three binary format parsers into a runtime where an
attacker-supplied allocation is a page crash rather than a refused file.

## Consequences

- A tool that inspects the host is now a dozen lines of TypeScript, and a tool
  that touches key material is still Rust. The split is by risk, and it is
  documented in [ARCHITECTURE.md](../ARCHITECTURE.md).
- `ToolManifest.origin` and `.version` are gone, along with the pack settings
  and the trust pins in `config.toml`. A config that still carries them loads,
  and the sections are ignored.
- The desktop app's Rust is now ~350 lines: window, file I/O, one `exec`, and the
  engine's lifetime. It holds no domain logic, so the "away from Rust" intent and
  Tauri's requirement that a shell exist are both satisfied.
- Users lose the browser surface. Anyone scripting against `/api/v1` must call
  the CLI instead; that is a breaking change, recorded in the changelog with a
  removal table in [COMPATIBILITY.md](../COMPATIBILITY.md).
- The project gives up third-party extension. If that comes back, it should come
  back as a reviewed set of tools rather than as arbitrary executables with
  declared capabilities.
