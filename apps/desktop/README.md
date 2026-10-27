# Desktop app

A Tauri 2 window around `packages/core`. The frontend imports the same runtime the
CLI uses, so the catalogue, the forms, the reports, and the audit trail cannot
disagree between the two.

```
apps/desktop/
├── index.html            the shell page
├── src/                  frontend: components, store, actions, Tauri host
├── src-tauri/            Rust shell: window, file I/O, engine lifetime
├── vite.config.ts
└── tsconfig.json
```

## How it fits together

```
src/main.ts → src/lib/engine.ts → @gimlet-eye/core Runtime
                                          │
                        src/lib/tauri-host.ts (Host over IPC)
                                          │
                             src-tauri/src/main.rs (commands)
                                          │
                                gimlet-sidecar (engine)
```

- **No server.** The window never binds a port and never fetches from one. There
  is no token and no CORS policy, because there is no HTTP surface.
- **No logic in Rust.** `src-tauri` exposes file operations, one `exec`, and the
  engine's lifetime. Everything that decides what a run means is in TypeScript.
- **The engine is bundled.** `gimlet-sidecar` is declared as a Tauri
  `externalBin`, so a packaged app carries its own copy. During development it is
  found in `target/{release,debug}`, or from `GIMLET_SIDECAR`.

## Running it

```bash
npm run dev        # Tauri dev window, hot-reloading frontend
npm run build      # bundle for this platform
npm run typecheck  # tsc --noEmit
npm test           # vitest + jsdom against a mocked engine
```

From the repository root, `./run.sh` builds the engine and the UI bundle first,
which is the shortest path from a fresh checkout to a window.

## Testing without a window

The frontend tests run in jsdom with `./lib/engine` mocked, so they exercise real
components, real validation, and real rendering without a browser or a Tauri
runtime. The engine's own behaviour is covered by `cargo test`, and the CLI's
end-to-end path by `scripts/smoke.sh`.

A Tauri bundle needs `webkit2gtk` (Linux), Xcode command-line tools (macOS), or
WebView2 (Windows); CI builds it on all three.
