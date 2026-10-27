# 0009 — Four surfaces, one contract

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

[0008](0008-typescript-surfaces-rust-engine.md) reduced the product to two
surfaces — a Node CLI and a Tauri window — and deleted the HTTP API, the browser
build, and the API token. That removed the largest attack surface in the
product, and the security model now says plainly that no port, token, or web
page can drive the tools.

The suite still has gaps for the people it is for. An operator on a jump host
has neither a desktop session nor a convenient way to remember 19 tool ids and
their arguments. A scan result is evidence, and evidence that can only be read
by someone who installed the toolkit is not evidence.

## Decision

Four surfaces, all over `packages/core`, none owning behaviour of its own:

| Surface | Entry point | Kind |
|---|---|---|
| CLI | `gimlet` | drives tools |
| TUI | `gimlet tui` | drives tools |
| Desktop | `apps/desktop` | drives tools |
| Web | `--format html` | reads a report |

- The **TUI** lives in `packages/cli/src/tui`. State transitions, key decoding,
  and frame rendering are pure functions with explicit sizes; only the session
  loop touches the TTY. It executes through `Runtime.run`, so a run started in
  the terminal is audited exactly like one started by the CLI.
- The **web surface is an output format, not a server.** `--format html` emits
  one self-contained document with inline CSS, a `default-src 'none'` content
  policy, no script, and no outbound reference. It is a viewer of a report the
  operator already produced.

## Consequences

**Positive**

- A fourth surface costs one output format and one package folder, because the
  catalogue and the report contract were already shared.
- Evidence travels: a report can be filed, emailed, or attached to a ticket
  without the recipient installing anything, and without the document being able
  to phone home when it is opened.
- Nothing new listens on a socket, so the threat model in `SECURITY.md` is
  unchanged.

**Negative**

- Two ways to drive the same tools means two places to keep honest; the shared
  tests are what hold them together, not discipline.
- The HTML report is static: no live filtering, no re-run button. That is the
  point, but it is a limitation worth naming.

## Rejected alternatives

- **Restore `gimlet serve` and a browser UI.** Fastest way to "web", and it
  re-opens exactly what 0008 closed: a local HTTP API, a token to manage, and
  CORS to get right, on a tool that reads private files.
- **A TUI with its own tool implementations.** Cheaper to write per tool, and it
  would drift from the CLI the first time an argument changed.
- **Ship a WASM build of the tools for the browser.** The engine's guarantees —
  streaming, bounded memory, fuzzed parsers — do not survive a rewrite into the
  browser environment, and the result would be a second implementation to audit.
