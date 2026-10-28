# The Gimlet Eye window

An Electron 45 window around `packages/core`. The UI is the same TypeScript the
CLI renders reports with, and the main process holds the only `Runtime`: the
renderer asks four questions and displays the answers.

```
apps/desktop/
├── electron/             the shell (TypeScript)
│   ├── main.ts           window, IPC validation, lifecycle
│   ├── preload.cts       four fixed channels -> window.gimlet (CommonJS)
│   └── api.ts            health/tools/run/audit, Electron-free and unit-tested
├── src/                  frontend: components, store, actions
│   └── lib/bridge.ts     the renderer's view of the machine
├── dist/                 the built UI (vite)
├── build/                the installer icon, rendered from the UI tokens
└── release/              installers, when `npm run package` is used
```

Data flows one way:

```
renderer (no Node)  ──window.gimlet.health/tools/run/audit──▶  main process
                                                                  │
                                                       Runtime + node:fs
```

## Why it is shaped this way

- **The renderer holds no runtime and no key material.** Under the previous Tauri
  shell the frontend held a `Runtime`, so a keystore passphrase and decrypted
  bytes existed inside a webview. Now a `Report` is the only thing that crosses.
- **No generic IPC.** The preload exposes four named calls; there is no
  `invoke(name, …)` for a compromised page to reach through. `main.ts` validates
  every argument and refuses a sender that is not the window.
- **Deny by default.** `contextIsolation`, `nodeIntegration: false`,
  `sandbox: true`, navigation prevented, `window.open` denied, every permission
  request refused, and a single-instance lock so two windows cannot race on one
  keystore.
- **The engine is in the bundle, not beside it.** `packages/engine` is TypeScript
  imported by `packages/core`, and the shell imports `@gimlet-eye/core/host-node`,
  so the window runs exactly the code the CLI does, with nothing staged next to
  it and no second binary to keep in step.

## Commands

```bash
npm run dev            # build the UI, compile the shell, open the window
npm run build          # build the UI and compile the shell
npm run icon           # render build/icon.png, which the installers use
npm run package        # build, then produce deb/AppImage/dmg/nsis in release/
npm run typecheck
npm test
```

`npm run icon` needs a display — it opens the app's own Chromium to draw the
mark, so the icon cannot drift from the UI — which means `xvfb-run` on a
headless machine. It is not part of `npm run package`; CI renders it before
packaging, and `.gitignore` keeps the PNG a build output.

## Requirements

Node 20+. No system webview, no Rust toolchain, and no GTK headers: Electron
ships its own Chromium, and the shell is TypeScript. The window needs a display,
which is why the four operations live in `electron/api.ts` and are tested
without one.
