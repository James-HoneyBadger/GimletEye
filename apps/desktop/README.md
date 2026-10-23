# Desktop shell

A Tauri 2 window that renders the shared UI from [`packages/ui`](../../packages/ui)
and talks to the local API.

There is deliberately **no business logic here**. The shell exists because a
desktop build needs an installer, a window, and a process boundary — not because
the desktop needs different code.

## Run

```bash
# terminal 1 — the engine
cargo run -p mellivora-cli -- serve

# terminal 2 — the shell
cd apps/desktop
npm install
npm run dev
```

`npm run build` produces platform bundles under
`apps/desktop/src-tauri/target/release/bundle/`.

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
