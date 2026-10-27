# 0011 — A Rust-free application platform

- **Status:** Accepted — 2026-10-27
- **Date:** 2026-10-27
- **Depends on:** [0010](0010-retire-rust.md) (retire Rust)

## Context

[0010](0010-retire-rust.md) moves the engine to TypeScript. That leaves one Rust
body: `apps/desktop/src-tauri`, 385 lines of Tauri shell plus its Cargo
dependencies, which owns the window and the operating-system boundary a webview
cannot reach (file reads and writes, one `exec`, and the engine process).

"No Rust anything" means that shell has to go too, so the GUI needs a new host.
The constraints are not generic:

1. **The UI is already TypeScript** (`apps/desktop/src`, tested with vitest and
   jsdom). It renders argument forms from `ToolManifest` and reports from
   `Report`, and it contains no tool-specific code.
2. **The boundary is already abstracted.** `apps/desktop/src/lib/tauri-host.ts`
   implements the `Host` interface over IPC; [main.rs](../apps/desktop/src-tauri/src/main.rs)
   exposes fifteen commands — `host_info`, `read_text_file`, `read_file`,
   `write_text_file`, `write_file`, `create_dir`, `remove_tree`, `path_exists`,
   `path_stat`, `read_dir`, `rename_path`, `chmod_owner_only`, `resolve_path`,
   `exec_command`, and `engine_request` — and nothing in the UI calls Tauri
   directly.
3. **The engine is Node.** After 0010 it is `node:crypto` and `@noble/hashes`,
   in process. A platform that cannot host Node must spawn it.
4. **Security model.** Since [0008](0008-typescript-surfaces-rust-engine.md)
   there is deliberately no listening port, no token, and no web page that can
   drive the tools. The window asks the shell, and the shell is the only thing
   with filesystem and `exec` access.
5. **Distribution.** The project ships deb, rpm, and Arch packages, and targets
   Linux first with Windows and macOS in the manifests.
6. **Size was already decided.** [0003](0003-one-ui-for-all-surfaces.md) rejected
   Electron for ~150 MB against Tauri's few MB — a judgement made when Rust was
   an acceptable part of the product.

## Options

| Candidate | Host language | UI reuse | Hosts the Node engine | Boundary | Installed size | Verdict |
|---|---|---|---|---|---|---|
| **Electron 45** | JS/TS | unchanged | **in process** | preload + `contextIsolation`, no port | ~120–180 MB | **chosen** |
| Neutralino.js 11 | C++ shell, JS API | unchanged | no — needs a Node child process | `os.exec` allowlist, local files | ~5 MB | runner-up |
| NW.js 0.119 | JS/TS | unchanged | in process | similar to Electron | ~120–180 MB | viable, smaller ecosystem |
| Wails (Go) | **Go** | unchanged | no — spawns Node | Go bindings | ~10–15 MB | adds a second language |
| Flutter | Dart | **full rewrite** | no | FFI/process | ~20 MB | rewrites the UI |
| Qt / PySide6 | C++/Python | **full rewrite** | no | Qt APIs | ~200 MB | rejected in 0003 |
| `gimlet serve` + browser | none (Node) | unchanged | yes | **loopback HTTP + token** | 0 MB extra | rejected in 0008 |

Sizes are typical installed footprints for the runtime, not measurements taken
in this repository — except the last column's UI, which is this project's own
bundle: `vite build` emits 77 kB of JavaScript (24 kB gzipped) and that does not
change with the host. The versions listed are what npm resolves today:
`electron@45.0.0`, `electron-builder@26.18.0`, `@neutralinojs/neu@11.8.0`,
`nw@0.119.2`.

## Decision

**Electron, with the runtime in the main process and a narrow preload bridge.**

The webview becomes a pure view: it holds no `Runtime`, no `Host` implementation,
and no key material. The main process holds the `Runtime`, owns the filesystem
and `exec`, and answers a small set of typed requests.

This is a security improvement over today's arrangement, not just a port. Under
Tauri the frontend holds a `Runtime`, so a keystore passphrase and any decrypted
bytes exist inside a webview. Moving the runtime to the main process means the
renderer only ever sees `ToolManifest` and `Report` — the same thing it is
already written to display.

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload exposes only: `catalogue()`, `run(tool, args)`, `history(limit)`,
  `health()`, and nothing else. No generic `invoke(name, …)` escape hatch.
- No `shell.openExternal`, no remote navigation, no `webviewTag`.
- `win.loadFile()`, never a URL; the CSP from the report renderer applies.
- `exec` stays in the main process and is used by the GPG tools only, with a
  fixed program and argument vector — never a shell string.

Packaging uses `electron-builder`: deb, rpm, AppImage, plus dmg and nsis for the
platforms the manifests already name. The three existing recipes keep calling
`scripts/stage-package.sh` for the CLI; the GUI becomes a separate package that
depends on it rather than duplicating it.

## Consequences

**Positive**

- One toolchain for the whole product: Node, npm, TypeScript, Vite. No Rust, no
  Go, no C++ build.
- The engine runs in the main process, which removes the sidecar entirely rather
  than replacing it with another IPC boundary.
- The existing UI, its tests, and the `Host` interface survive unchanged; only
  `tauri-host.ts` is replaced by `ipc-host.ts` and the shell is written in
  TypeScript. The whole surface is fifteen commands over `node:fs`,
  `node:child_process`, and the engine — a direct transcription of the `Host`
  interface, not a new domain to learn.
- Key material stops crossing into a renderer.

**Negative**

- **The install grows from ~10 MB to ~150 MB**, and that is a real regression
  against [0003](0003-one-ui-for-all-surfaces.md). 0003's judgement was made
  when Rust was acceptable; with Rust excluded, the choice is between 150 MB of
  Chromium and a second language. This record chooses the megabytes.
- Chromium is a large, frequently-CVE'd dependency. A release cadence that
  tracks Electron majors is now part of maintaining the product, where before it
  followed the system webview.
- Two processes instead of one means an IPC surface to keep minimal and review;
  the preload list above is the contract.

## Rejected alternatives

- **Neutralino.js.** The closest competitor, and the only one that keeps the
  binary small. It loses on the engine: there is no Node runtime inside it, so
  the TypeScript engine would run as a child `gimlet` process spoken to over
  stdio — the exact sidecar boundary 0010 is removing, with a smaller security
  team behind it.
- **A loopback web UI (`gimlet serve`).** Cheapest and smallest, and it needs no
  shell at all. It re-opens the attack surface 0008 closed: a listener that any
  local process can reach, a token to distribute, and origin rules to get right,
  on a tool whose job is to read private files.
- **Wails.** Small and pleasant, but "no Rust" was not "any compiled language":
  it trades a Rust toolchain for a Go one and still cannot host the engine.
- **Shipping the CLI and a browser only.** Honest, zero new runtime, and the
  HTML report already covers evidence. It is not a GUI, which the product
  promises.

## Migration

| Step | Work | Gate |
|---|---|---|
| 1 | `apps/desktop/electron/main.ts` + `preload.ts`; `Runtime` in the main process | `npm run build:ui` and the jsdom tests unchanged |
| 2 | `ipc-host.ts` in the frontend, replacing `tauri-host.ts` for the shell's own operations | the existing `apps/desktop` tests pass with the adapter swapped |
| 3 | Packaging: `electron-builder` targets for deb/rpm/AppImage, `stage-package.sh` unchanged | `check-package-layout.sh` and `check-packaging.sh` |
| 4 | Delete `apps/desktop/src-tauri`, its `Cargo.toml`/`Cargo.lock`, the `desktop` CI job's Rust steps | `make check` with no Rust toolchain installed |

Step 4 is the commit where the repository contains no Rust.
