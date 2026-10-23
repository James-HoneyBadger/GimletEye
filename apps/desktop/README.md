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

## Why Tauri rather than keeping GTK3, PySide6, and Electron

The three source projects shipped three GUI toolkits. One of them had to go.

- **Tauri** reuses the Rust core directly, ships small binaries, and lets the
  same HTML/CSS/TS bundle serve the browser, the desktop window, and — later —
  the WASM target.
- **GTK3 (Perl Den)** is tied to Perl and Linux desktops.
- **PySide6 (DarkStar)** duplicates every view in Python against the same API.
- **Electron (HB_Scrub)** bundles a full Chromium runtime for what is now a
  6 KB UI bundle.

The PySide6 GUI's workflows are being migrated into the shared UI; the Rust and
Python APIs stay available for scripting.
