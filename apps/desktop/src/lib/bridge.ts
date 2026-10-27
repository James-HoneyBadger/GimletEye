/**
 * The window's view of the machine.
 *
 * Four calls, provided by the Electron preload. The renderer holds no `Runtime`
 * and no filesystem access: the main process owns both, so a keystore passphrase
 * and decrypted bytes never enter a webview.
 *
 * `bridge()` throws rather than returning undefined if the preload is absent, so
 * opening `dist/index.html` in a browser fails with a sentence instead of an
 * empty catalogue.
 */

import type { Args, AuditEntry, Report, ToolManifest } from '@gimlet-eye/core';

export interface Health {
  status: 'ok';
  version: string;
  engine: string;
  tools: number;
  home: string;
}

export interface AuditTail {
  entries: AuditEntry[];
  path: string;
  enabled: boolean;
}

export interface GimletBridge {
  health(): Promise<Health>;
  tools(): Promise<ToolManifest[]>;
  run(tool: string, args: Args, dryRun: boolean): Promise<Report>;
  audit(limit: number): Promise<AuditTail>;
}

declare global {
  interface Window {
    gimlet?: GimletBridge;
  }
}

export function bridge(): GimletBridge {
  const api = window.gimlet;
  if (api === undefined) {
    throw new Error('the desktop bridge is not available: launch the app, not the built page');
  }
  return api;
}
