# 0003 — One UI for desktop and browser

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

The three projects ship four GUI stacks:

| Stack | Project | Runtime cost |
|---|---|---|
| GTK3 + GtkSourceView | Perl Den | system libs, Linux-focused |
| PySide6 | DarkStar | Python + Qt (~200 MB), duplicated views |
| Tauri 2 | HB_Scrub | Rust + system webview (small) |
| Electron | HB_Scrub (legacy) | bundled Chromium (~150 MB) |

All four render the same thing: lists of operations, a form, and a result.

## Decision

One TypeScript UI in `packages/ui`, built by Vite, rendered by:

- **Tauri 2** for the desktop app (`apps/desktop`, thin shell),
- **`mellivora serve --ui-dir`** for the browser,
- the Vite dev server during development.

The UI is driven entirely by `ToolManifest`: it renders argument forms from the
manifest and reports from `Report`. It contains no tool-specific code.

## Consequences

**Positive**

- One UI codebase instead of four; a new tool appears in every surface with no
  frontend change.
- Desktop binaries stay small (system webview, no bundled Chromium).
- The same bundle can later be served to WASM-only tools.

**Negative**

- Abandons the GTK3 and Qt look users may have customised (themes, keybindings).
- Requires a local API process for the desktop shell until the server is
  embedded in the Tauri process.
- Browser UI needs CORS and a loopback API; authentication would be required
  before any non-loopback bind.

**Mitigations**

- Theme parity is a CSS concern; DarkStar's dark palette is the default.
- Embedding the server in the desktop process is a contained follow-up.
- Keep the Python and Rust APIs published so power users are not blocked.

## Rejected alternatives

- **Keep three GUIs:** triples UI maintenance and keeps the projects separate in
  users' minds.
- **Electron:** large runtime for a small UI; Tauri covers the same need.
- **Terminal-only (TUI):** cheaper, but the source projects have graphical
  workflows (key management, drag-and-drop files) that a TUI cannot express.
