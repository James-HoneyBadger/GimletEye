/**
 * The renderer's entire view of the machine.
 *
 * Four functions, each a fixed channel. Nothing here takes a channel name from
 * the caller, so a compromised page cannot invent one, and nothing returns a
 * function or a stream it could drive.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';

/** A reply from the main process: the answer, or the reason there is none. */
type Reply<T> = T | { ok: false; message: string };

/**
 * Ask a fixed channel, and turn a failure envelope back into an Error.
 *
 * The main process resolves failures rather than throwing them: a thrown
 * message arrives here as "Error invoking remote method 'gimlet-works:run': …",
 * which is plumbing the person in front of the window should never read.
 */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as Reply<T>;
  if (reply !== null && typeof reply === 'object' && (reply as { ok?: unknown }).ok === false) {
    throw new Error((reply as { message: string }).message);
  }
  return reply as T;
}

/**
 * A file dragged in from the desktop is a real path, and `File.path` is gone
 * from current Electron. Only the preload may ask for it; the answer is left on
 * the drop zone as an attribute, so no object crosses the isolation boundary.
 */
window.addEventListener(
  'drop',
  (event) => {
    const file = event.dataTransfer?.files?.[0];
    const zone = event.target instanceof Element ? event.target.closest('[data-drop-zone]') : null;
    if (!file || !zone) return;
    let path = '';
    try {
      path = webUtils.getPathForFile(file);
    } catch {
      path = '';
    }
    if (path === '') return;
    zone.setAttribute('data-dropped-path', path);
    zone.dispatchEvent(new Event('gimlet-works:dropped', { bubbles: true }));
  },
  true,
);

const gimletWorks = {
  health: (): Promise<unknown> => call('gimlet-works:health'),
  doctor: (): Promise<unknown> => call('gimlet-works:doctor'),
  tools: (): Promise<unknown> => call('gimlet-works:tools'),
  run: (tool: string, args: Record<string, string | number | boolean | null>, dryRun: boolean): Promise<unknown> =>
    call('gimlet-works:run', tool, args, dryRun),
  audit: (limit: number): Promise<unknown> => call('gimlet-works:audit', limit),
  pick: (mode: 'file' | 'directory' | 'either'): Promise<unknown> => call('gimlet-works:pick', mode),
  reveal: (path: string): Promise<unknown> => call('gimlet-works:reveal', path),
  copy: (text: string): Promise<unknown> => call('gimlet-works:copy', text),
};

contextBridge.exposeInMainWorld('gimletWorks', gimletWorks);

export type GimletWorksBridge = typeof gimletWorks;
