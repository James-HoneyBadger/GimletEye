# Desktop app

A Tauri 2 window that renders the shared UI from [`packages/ui`](../../packages/ui)
over an engine embedded in the same process.

There is deliberately **no business logic here**. The shell exists because a
desktop build needs an installer and a window — not because the desktop needs
different code. Everything the window shows comes from `ToolManifest.args` and
`Report`, exactly as in the browser.

## Run

```bash
cd apps/desktop
npm install
npm run dev     # hot-reloading window against the Vite dev server
npm run build   # platform bundles under src-tauri/target/release/bundle/
```

There is no separate server to start: `src-tauri/src/main.rs` binds an
ephemeral loopback port, starts `mellivora-toolkit`'s `Runtime` on a background
thread, and injects the port into the window as `window.__MELLIVORA_API__`
before the first script runs.

To run the shell straight from Cargo, build it self-contained — a plain debug
build follows `devUrl` and expects Vite on port 5173:

```bash
cd apps/desktop/src-tauri
cargo build --features tauri/custom-protocol
./target/debug/mellivora-desktop
```

The engine prints its address on startup (`mellivora: embedded engine on
http://127.0.0.1:<port>`) and reads packs from `plugins/` next to the binary or
in the checkout, via `MELLIVORA_PLUGIN_PATH`. `mellivora serve` is unaffected
and remains the way to reach the same tools from a browser or another machine.

## Why Tauri rather than GTK, Qt, or Electron

Four GUI toolkits were on the table. One of them had to win.

- **Tauri** reuses the Rust core directly, ships small binaries, and lets the
  same HTML/CSS/TS bundle serve the browser, the desktop window, and — later —
  the WASM target.
- **GTK3** ties the app to Linux desktop libraries.
- **PySide6** means writing every view twice: once in Python, once for the
  web.
- **Electron** bundles a full Chromium runtime for what is now a 6 KB UI
  bundle.

The Python and Rust APIs stay available for scripting; the shared UI is the
only graphical surface to maintain.
