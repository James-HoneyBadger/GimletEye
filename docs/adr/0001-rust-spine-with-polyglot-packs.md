# 0001 — Rust workspace as the spine, with polyglot packs

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

Three projects must become one toolkit:

- **Perl_Den** — 20 tested sysadmin modules in Perl, plus a GTK3 IDE.
- **Zayfer_Vault (DarkStar)** — a Rust crypto core with CLI, PyO3, WASM, a
  PySide6 GUI, and a web UI.
- **NakiByte (HB_Scrub)** — a zero-dependency TypeScript metadata library with
  CLI, Tauri, Electron, and web surfaces.

Every option has a cost:

| Option | Cost |
|---|---|
| Rewrite everything in Rust | 12–18 months before parity; throws away the Perl test suite and the TypeScript format handlers |
| Python-first | Weak fit for crypto streaming and WASM; the Rust core would still be needed |
| TypeScript-first | Node runtime required for sysadmin work; performance and memory for multi-GB files |
| Keep three toolkits with a shared UI | Exactly the maintenance cost we are trying to remove |
| Rust spine + out-of-process packs | Two protocols to maintain; pack calls cannot share memory |

## Decision

Build a Rust workspace as the single engine, and let other languages join as
**packs**: separate executables speaking a line-delimited JSON-RPC protocol over
stdio.

- The Rust crates own the contract (`mellivora-core`), the crypto and privacy
  primitives, and all high-performance paths.
- Existing Perl and TypeScript code is reused through adapters rather than
  rewritten under deadline pressure.
- Packs are sandboxed by process boundaries and timeouts, and constrained by
  declared capabilities.

## Consequences

**Positive**

- Usable in weeks, not quarters: all 20 Perl Den modules work today.
- Ports can proceed module by module, with the old implementation serving as an
  oracle for tests.
- A pack crash or hang cannot take down the engine.
- Third parties can extend the toolkit in their own language.

**Negative**

- Two contract surfaces to keep compatible: `Tool`/`Report` and the protocol.
- Per-call latency for pack tools (process spawn + JSON), unacceptable for hot
  loops.
- Pack tooling (framing, encoding, flushing) is a source of subtle bugs; the
  Perl pack already needed UTF-8 normalization because Perl Den's sources lack
  `use utf8`.

**Mitigations**

- One schema (`ToolManifest`, `Report`) is shared by both paths, so a port is a
  new implementation of an existing contract, not a new API.
- Protocol conformance checklist in [PLUGIN_SDK.md](../PLUGIN_SDK.md).
- `mellivora plugins doctor` plus a live CI slice catch framing regressions.

## Alternatives rejected

- **Full Rust port first:** delays the unified product and discards working,
  tested code.
- **Embedded interpreters (perl FFI, Node N-API):** couples build matrices to
  native toolchains, risking the "runs anywhere" property; is harder to sandbox.
