/**
 * The window, and the only thing that touches the machine.
 *
 * The renderer is a view: it holds no `Runtime`, no host, and no key material —
 * it asks for a catalogue, a report, or the audit tail. That is a deliberate
 * change from the Tauri shell, where the frontend held the runtime and a
 * passphrase therefore existed inside a webview.
 *
 * The preload exposes named calls and nothing else; there is no generic
 * `invoke(name, …)` for a compromised renderer to reach through. The policy that
 * backs that up lives in `session-policy.ts`, the channels in `handlers.ts`, and
 * the menu in `menu-template.ts` — each one a function so it can be tested
 * without a display.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, session, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isWithin } from '@gimlet-eye/core';

import { createApi } from './api.js';
import { clampBounds, type Bounds } from './bounds.js';
import { registerHandlers, type PickerMode } from './handlers.js';
import { installMenu } from './menu.js';
import { createRuntimeLoader } from './runtime.js';
import { installSessionPolicy } from './session-policy.js';
import { readWindowBounds, writeWindowBounds } from './window-state.js';

const here = dirname(fileURLToPath(import.meta.url));

// Every renderer runs sandboxed, including any the shell creates later. Set
// before the app is ready, which is when Electron reads it.
app.enableSandbox();

let window: BrowserWindow | null = null;

const runtime = createRuntimeLoader();
const api = createApi(runtime);

const DEFAULT_SIZE = { width: 1180, height: 800 };

function windowStateFile(): string {
  return join(app.getPath('userData'), 'window.json');
}

function defaultBounds(): Bounds {
  const area = screen.getPrimaryDisplay().bounds;
  return {
    x: Math.round(area.x + (area.width - DEFAULT_SIZE.width) / 2),
    y: Math.round(area.y + (area.height - DEFAULT_SIZE.height) / 2),
    ...DEFAULT_SIZE,
  };
}

function createWindow(): void {
  const fallback = defaultBounds();
  const saved = readWindowBounds(windowStateFile());
  const bounds = clampBounds(
    saved ?? fallback,
    screen.getAllDisplays().map((display) => ({ bounds: display.bounds })),
    fallback,
  );

  window = new BrowserWindow({
    ...bounds,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#14110e',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      // Chromium's spellchecker is a dictionary download and a network stack the
      // toolkit does not need.
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window?.show());

  // The UI is a local file. It never navigates, and it never opens a window:
  // a report that quotes a hostile string must not become a way out.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  void window.loadFile(join(here, '..', '..', 'dist', 'index.html'));

  // Geometry is written after the dust settles, not on every pixel of a drag.
  let pending: NodeJS.Timeout | undefined;
  const remember = (): void => {
    if (pending !== undefined) clearTimeout(pending);
    pending = setTimeout(() => {
      if (window !== null && !window.isDestroyed()) writeWindowBounds(windowStateFile(), window.getBounds());
    }, 400);
  };
  window.on('resize', remember);
  window.on('move', remember);

  window.on('closed', () => {
    window = null;
  });
}

function senderIsWindow(event: Electron.IpcMainInvokeEvent): boolean {
  return window !== null && event.sender === window.webContents;
}

function showAbout(): void {
  const options = {
    type: 'info' as const,
    title: 'About Gimlet Eye',
    message: `Gimlet Eye ${app.getVersion()}`,
    detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}\n\nEverything runs locally: nothing leaves this machine.`,
    buttons: ['OK'],
  };
  const parent = BrowserWindow.getFocusedWindow();
  if (parent) void dialog.showMessageBox(parent, options);
  else void dialog.showMessageBox(options);
}

async function pickOne(mode: PickerMode): Promise<{ path: string | null }> {
  const options: Electron.OpenDialogOptions = {
    title: mode === 'directory' ? 'Choose a folder' : mode === 'either' ? 'Choose a file or folder' : 'Choose a file',
    properties:
      mode === 'directory' ? ['openDirectory'] : mode === 'either' ? ['openFile', 'openDirectory'] : ['openFile'],
  };
  const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
  return { path: result.canceled ? null : result.filePaths[0] ?? null };
}

/** Only what the runtime owns can be opened: never an arbitrary path. */
async function revealOwned(target: string): Promise<{ ok: true }> {
  const { home } = await api.health();
  if (!isWithin(home, target)) throw new Error('only paths inside the data folder can be opened');
  const problem = await shell.openPath(target);
  if (problem !== '') throw new Error(problem);
  return { ok: true };
}

function register(): void {
  registerHandlers({
    ipc: ipcMain,
    api,
    isWindow: senderIsWindow,
    pick: pickOne,
    reveal: revealOwned,
    copy: (text) => clipboard.writeText(text),
  });
}

// One instance, because two would race on the same keystore and audit trail.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window !== null) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  void app.whenReady().then(() => {
    installSessionPolicy(session.defaultSession);
    register();
    installMenu({ platform: process.platform, version: app.getVersion(), about: showAbout });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Nothing in this app opens a URL, so nothing should be able to ask.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
