# 0003 — One UI for desktop and browser

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

The toolkit needs a graphical surface, and the obvious choices each carry a
different cost:

| Stack | Runtime cost |
|---|---|
| GTK3 / GtkSourceView | system libraries, essentially Linux-only |
| Qt (PySide6) | Python + Qt (~200 MB), every view written twice for the web |
| Tauri 2 | Rust + the system webview (small) |
| Electron | bundled Chromium (~150 MB) |

All four render the same thing: a list of operations, a form, and a result.

## Decision

One TypeScript UI in `packages/ui`, built by Vite, rendered by:

- **Tauri 2** for the desktop app (`apps/desktop`, thin shell),
- **`mellivora serve --ui-dir`** for the browser,
- the Vite dev server during development.

The UI is driven entirely by `ToolManifest`: it renders argument forms from the
manifest and reports from `Report`. It contains no tool-specific code.

## Consequences

**Positive**

- One UI codebase; a new tool appears in every surface with no frontend change.
- Desktop binaries stay small (system webview, no bundled Chromium).
- The same bundle can later serve WASM-only tools, and can run over SSH via a
  forwarded port.

**Negative**

- Users lose native toolkit theming and platform-specific widgets.
- The desktop shell needs a local API process until the server is embedded.
- The browser UI needs CORS and a loopback API; authentication is required
  before any non-loopback bind.

**Mitigations**

- Theme parity is a CSS concern; the default palette is a dark amber-on-charcoal.
- Embedding the server in the desktop process is a contained follow-up.
- The Rust and Python APIs stay published so scripted workflows are unaffected.

## Rejected alternatives

- **One GUI per domain:** multiplies UI maintenance and splits the product.
- **Electron:** a large runtime for a small UI; Tauri covers the same need.
- **Terminal-only:** cheaper, but key management and drag-and-drop file work do
  not fit a TUI, and the desktop app is a requirement.
