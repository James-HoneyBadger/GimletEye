/**
 * The renderer's entire view of the machine.
 *
 * Four functions, each a fixed channel. Nothing here takes a channel name from
 * the caller, so a compromised page cannot invent one, and nothing returns a
 * function or a stream it could drive.
 */

import { contextBridge, ipcRenderer } from 'electron';

const gimlet = {
  health: (): Promise<unknown> => ipcRenderer.invoke('gimlet:health'),
  tools: (): Promise<unknown> => ipcRenderer.invoke('gimlet:tools'),
  run: (tool: string, args: Record<string, string | number | boolean | null>, dryRun: boolean): Promise<unknown> =>
    ipcRenderer.invoke('gimlet:run', tool, args, dryRun),
  audit: (limit: number): Promise<unknown> => ipcRenderer.invoke('gimlet:audit', limit),
};

contextBridge.exposeInMainWorld('gimlet', gimlet);

export type GimletBridge = typeof gimlet;
