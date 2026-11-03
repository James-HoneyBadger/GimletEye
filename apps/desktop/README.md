# The Gimlet Works window

An Electron 45 window around `packages/core`. The UI is the same TypeScript the
CLI renders reports with, and the main process holds the only `Runtime`: the
renderer asks a fixed set of questions and displays the answers. There are two
views — the parameters (`components/workbench.ts`) and the report
(`components/report.ts`) — and the command palette (`components/palette.ts`) is
how either is reached from the keyboard.

```
apps/desktop/
├── electron/             the shell (TypeScript)
│   ├── main.ts           window, lifecycle, and the wiring between these
│   ├── handlers.ts       every channel, its validation and failure envelope
│   ├── session-policy.ts deny-by-default permissions and the local-scheme filter
│   ├── menu-template.ts  the menu as data; menu.ts installs it
│   ├── runtime.ts        one runtime, retried after a failed load
│   ├── bounds.ts         remembered geometry, clamped to the displays that exist
│   ├── window-state.ts   the four numbers, read and written in the profile
│   ├── preload.cts       fixed channels -> window.gimletWorks (CommonJS)
│   └── api.ts            health/doctor/tools/run/audit, Electron-free and tested
├── src/                  frontend: components, store, actions
│   ├── lib/bridge.ts     the renderer's view of the machine
│   ├── lib/run.ts        where a run's values come from, and what it would send
│   ├── lib/report-view.ts what the report view draws, derived from the state
│   ├── lib/preferences.ts parsing and migration for what the window remembers
│   ├── lib/shortcuts.ts  one table for the hints, the sheet, and the handler
│   └── styles/tokens.css the type, space, radius, colour and density vocabulary
├── e2e/run.mjs           the real window, driven end to end
├── e2e/shots.mjs         deterministic screenshots; baselines/ holds the set
├── dist/                 the built UI (vite)
├── build/                the installer icon, rendered from the UI tokens
└── release/              installers, when `npm run package` is used
```

Data flows one way:

```
renderer (no Node)  ──window.gimletWorks.health/tools/run/audit──▶  main process
                                                                  │
                                                       Runtime + node:fs
```

## Why it is shaped this way

- **The renderer holds no runtime and no key material.** Under the previous Tauri
  shell the frontend held a `Runtime`, so a keystore passphrase and decrypted
  bytes existed inside a webview. Now a `Report` is the only thing that crosses.
- **No generic IPC.** The preload exposes named calls only; there is no
  `invoke(name, …)` for a compromised page to reach through. `main.ts` validates
  every argument and refuses a sender that is not the window. A file dialog and a
  dropped file are answered by the preload and the main process, so the page
  never gains a filesystem handle.
- **Deny by default.** `contextIsolation`, `nodeIntegration: false`,
  `sandbox: true`, navigation prevented, `window.open` denied, every permission
  request refused, and a single-instance lock so two windows cannot race on one
  keystore.
- **The engine is in the bundle, not beside it.** `packages/engine` is TypeScript
  imported by `packages/core`, and the shell imports `@gimlet-works/core/host-node`,
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
make shots             # capture the window in its baseline states
make shots-check       # diff a fresh capture against e2e/baselines
```

The window is tested at three levels: component tests in `src/**/*.test.ts`
against a mocked bridge, shell tests in `electron/*.test.ts` against fakes (no
Electron, no display), and `e2e/run.mjs`, which drives the real app and reads the
files it wrote. `e2e/shots.mjs` photographs nine states at two sizes and two
themes with volatile values masked, so a layout change is visible in review; its
baselines have to be produced under the `e2e` job's runner, and `baselines/`
says how.

`npm run icon` needs a display — it opens the app's own Chromium to draw the
mark, so the icon cannot drift from the UI — which means `xvfb-run` on a
headless machine. It is not part of `npm run package`; CI renders it before
packaging, and `.gitignore` keeps the PNG a build output.

## Requirements

Node 20+. No system webview, no Rust toolchain, and no GTK headers: Electron
ships its own Chromium, and the shell is TypeScript. The window needs a display,
which is why the questions the window asks of the runtime — health, a doctor
snapshot, the catalogue, a run, the audit tail — live in `electron/api.ts` and are
tested without one. The shell's rules are split the same way: `handlers.ts`
validates every channel, `session-policy.ts` refuses permissions, `menu-template.ts`
is the menu as data, and `bounds.ts` decides where the window may reopen.
