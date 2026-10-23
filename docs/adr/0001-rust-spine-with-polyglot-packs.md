# 0001 — Rust workspace as the spine, with polyglot packs

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

The toolkit has to cover three domains — system administration, cryptography,
and metadata privacy — behind one interface. Two of those domains are
security-sensitive, one processes multi-gigabyte files, and all three are
expected to keep growing with new checks and file formats.

Every implementation strategy has a cost:

| Option | Cost |
|---|---|
| One language for everything, rewritten in Rust | Highest safety and performance, but every new capability pays the full cost of a rewrite before it can ship |
| One language for everything, dynamic (Python/TypeScript) | Fast to write, weak fit for streaming crypto and useless for WASM; native extensions arrive anyway |
| Many small tools with a shared shell | No shared contract, no shared audit trail, and the interface drifts per tool |
| Rust spine + out-of-process packs | Two contracts to keep compatible; per-call latency for pack tools |

## Decision

Build a Rust workspace as the single engine, and let other languages join as
**packs**: separate executables speaking a line-delimited JSON-RPC protocol over
stdio.

- The Rust crates own the contract (`mellivora-core`), the crypto and privacy
  primitives, and every performance-critical path.
- A pack is how a capability ships before it is worth writing in Rust — whether
  that is a contributor's existing library, an adapter around another runtime,
  or a third-party extension.
- Packs are sandboxed by process boundaries and timeouts, and constrained by
  declared capabilities.

## Consequences

**Positive**

- New capabilities can ship in days rather than quarters.
- A pack crash or hang cannot take down the engine.
- Contributors can use the language that fits the job, which widens the pool.
- Porting is incremental: a pack can be replaced by a native module when the
  measurement justifies it, with no change to any surface.

**Negative**

- Two contract surfaces to keep compatible: `Tool`/`Report` and the protocol.
- Per-call latency for pack tools (process spawn + JSON), unacceptable in hot
  loops.
- Pack tooling (framing, encoding, flushing) is a source of subtle bugs; the
  first real pack needed UTF-8 normalization because its modules do not declare
  `use utf8`.

**Mitigations**

- One schema (`ToolManifest`, `Report`) is shared by both paths, so a port is a
  new implementation of an existing contract, not a new API.
- Protocol conformance checklist in [PLUGIN_SDK.md](../PLUGIN_SDK.md).
- `mellivora plugins doctor` plus a live CI slice catch framing regressions.

## Alternatives rejected

- **Everything in Rust first:** delays usable software and discards working
  implementations that already exist.
- **Embedded interpreters (perl FFI, Node N-API):** couples the build matrix to
  native toolchains, risks the "runs anywhere" property, and is harder to sandbox.
