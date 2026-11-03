import type { IpcMainInvokeEvent } from 'electron';

import type { DesktopApi } from './api.js';
import { validateRunArgs } from './validate.js';

/** What a picker may ask for: a file, a folder, or either. */
export type PickerMode = 'file' | 'directory' | 'either';

export interface IpcSurface {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
}

export interface HandlerDependencies {
  ipc: IpcSurface;
  api: DesktopApi;
  /** True only for the window this app created. */
  isWindow: (event: IpcMainInvokeEvent) => boolean;
  pick: (mode: PickerMode) => Promise<{ path: string | null }>;
  reveal: (target: string) => Promise<{ ok: true }>;
  copy: (text: string) => void;
}

/**
 * A failed call, as the window is allowed to see it.
 *
 * Electron turns anything a handler throws into "Error invoking remote method
 * '…': …", which is plumbing rather than a sentence. Resolving with an envelope
 * keeps the message that was produced; the preload raises a plain Error from it.
 */
export interface Failure {
  ok: false;
  message: string;
}

export function failure(error: unknown): Failure {
  return { ok: false, message: error instanceof Error ? error.message : String(error) };
}

const MAX_CLIPBOARD = 1_000_000;

/**
 * Every channel the window has, with its validation.
 *
 * Kept apart from `main.ts` so the rules — who may call, what an argument may be,
 * what a failure looks like — are testable without launching Electron.
 */
export function registerHandlers({ ipc, api, isWindow, pick, reveal, copy }: HandlerDependencies): void {
  ipc.handle('gimlet-works:health', async (event) => {
    if (!isWindow(event)) throw new Error('unexpected sender');
    try {
      return await api.health();
    } catch (error) {
      return failure(error);
    }
  });

  ipc.handle('gimlet-works:doctor', async (event) => {
    if (!isWindow(event)) throw new Error('unexpected sender');
    try {
      return await api.doctor();
    } catch (error) {
      return failure(error);
    }
  });

  ipc.handle('gimlet-works:tools', async (event) => {
    if (!isWindow(event)) throw new Error('unexpected sender');
    try {
      return await api.tools();
    } catch (error) {
      return failure(error);
    }
  });

  ipc.handle('gimlet-works:run', async (event, tool: unknown, args: unknown, dryRun: unknown) => {
    if (!isWindow(event)) throw new Error('unexpected sender');
    if (typeof tool !== 'string' || tool === '') return failure(new Error('tool must be a non-empty string'));
    if (typeof dryRun !== 'boolean') return failure(new Error('dryRun must be a boolean'));
    try {
      return await api.run(tool, validateRunArgs(args), dryRun);
    } catch (error) {
      return failure(error);
    }
  });

  ipc.handle('gimlet-works:audit', async (event, limit: unknown) => {
    if (!isWindow(event)) throw new Error('unexpected sender');
    const count = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : 50;
    try {
      return await api.audit(count);
    } catch (error) {
      return failure(error);
    }
  });

  ipc.handle('gimlet-works:pick', async (event, mode: unknown) => {
    if (!isWindow(event)) throw new Error('unexpected sender');
    if (mode !== 'file' && mode !== 'directory' && mode !== 'either') {
      return failure(new Error("mode must be 'file', 'directory', or 'either'"));
    }
    try {
      return await pick(mode);
    } catch (error) {
      return failure(error);
    }
  });

  // Only what the runtime owns can be opened from here: the window may ask for a
  // folder it was told about, never for an arbitrary path.
  ipc.handle('gimlet-works:reveal', async (event, target: unknown) => {
    if (!isWindow(event)) throw new Error('unexpected sender');
    if (typeof target !== 'string' || target === '') return failure(new Error('target must be a non-empty string'));
    try {
      return await reveal(target);
    } catch (error) {
      return failure(error);
    }
  });

  // Copying is a desktop capability, not a web permission: the session denies
  // every permission request, so the renderer asks the main process instead.
  ipc.handle('gimlet-works:copy', async (event, text: unknown) => {
    if (!isWindow(event)) throw new Error('unexpected sender');
    if (typeof text !== 'string') return failure(new Error('text must be a string'));
    if (text.length > MAX_CLIPBOARD) return failure(new Error('refusing to copy more than 1 MB'));
    try {
      copy(text);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });
}
