/**
 * The window, and the only thing that touches the machine.
 *
 * The renderer is a view: it holds no `Runtime`, no host, and no key material —
 * it asks for a catalogue, a report, or the audit tail. That is a deliberate
 * change from the Tauri shell, where the frontend held the runtime and a
 * passphrase therefore existed inside a webview.
 *
 * The preload exposes four calls and nothing else; there is no generic
 * `invoke(name, …)` for a compromised renderer to reach through.
 */

import { app, BrowserWindow, ipcMain, session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

import { nodeHost } from '@gimlet-eye/core/host-node';
import { NODE_TOOLS, Runtime } from '@gimlet-eye/core/node';

import type { Args } from '@gimlet-eye/core';
import { createApi } from './api.js';

let window: BrowserWindow | null = null;
let runtimePromise: Promise<Runtime> | undefined;

/** One runtime for the process, created on first use. */
function runtime(): Promise<Runtime> {
  if (runtimePromise === undefined) {
    runtimePromise = Runtime.load(nodeHost(), { localTools: NODE_TOOLS });
  }
  return runtimePromise;
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 800,
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
    },
  });

  window.once('ready-to-show', () => window?.show());

  // The UI is a local file. It never navigates, and it never opens a window:
  // a report that quotes a hostile string must not become a way out.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  void window.loadFile(join(here, '..', '..', 'dist', 'index.html'));
  window.on('closed', () => {
    window = null;
  });
}

function senderIsWindow(event: Electron.IpcMainInvokeEvent): boolean {
  return window !== null && event.sender === window.webContents;
}

function register(): void {
  const api = createApi(runtime);

  ipcMain.handle('gimlet:health', async (event) => {
    if (!senderIsWindow(event)) throw new Error('unexpected sender');
    return api.health();
  });

  ipcMain.handle('gimlet:tools', async (event) => {
    if (!senderIsWindow(event)) throw new Error('unexpected sender');
    return api.tools();
  });

  ipcMain.handle('gimlet:run', async (event, tool: unknown, args: unknown, dryRun: unknown) => {
    if (!senderIsWindow(event)) throw new Error('unexpected sender');
    if (typeof tool !== 'string' || tool === '') throw new Error('tool must be a non-empty string');
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new Error('args must be an object');
    }
    if (typeof dryRun !== 'boolean') throw new Error('dryRun must be a boolean');
    return api.run(tool, args as Args, dryRun);
  });

  ipcMain.handle('gimlet:audit', async (event, limit: unknown) => {
    if (!senderIsWindow(event)) throw new Error('unexpected sender');
    const count = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : 50;
    return api.audit(count);
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
    // A report renderer needs no camera, microphone, notification, or clipboard
    // read; denying them all is cheaper than auditing each use.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    register();
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
