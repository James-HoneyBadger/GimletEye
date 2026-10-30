/**
 * Publishing the sealed keystore, once, and only over what was opened.
 *
 * `crypto.keygen`, `crypto.key-import`, and `crypto.key-rotate` are all
 * read-modify-write over one file, and two surfaces can hold it at the same
 * time: the window and a terminal, or two terminals. The last writer used to
 * win, which is the one failure a key store cannot have — the keys the other
 * session added were never reported missing, they were simply gone.
 *
 * A store is a few kilobytes, so the check is the cheap one: keep the bytes that
 * were opened, and refuse to publish over anything else. That is not a lock —
 * there is still a window between the re-read and the rename — but it turns a
 * silent loss into a refusal the user can act on.
 */

import { conflict } from '../errors.js';
import { tempName } from '../pathutil.js';
import type { Host } from '../host.js';

export interface OpenedStore {
  path: string;
  /** The bytes that were opened, or `null` when the store did not exist yet. */
  bytes: Buffer | null;
}

/** The store's current bytes, or `null`: the same shape `OpenedStore` records. */
export async function readStoreBytes(host: Host, path: string): Promise<Buffer | null> {
  return (await host.exists(path)) ? Buffer.from(await host.readFile(path)) : null;
}

function sameBytes(a: Buffer | null, b: Buffer | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.equals(b);
}

/**
 * Write `bytes` to the store, provided it still holds what was opened.
 *
 * The temporary is private per writer — two surfaces saving at once must not
 * share a path — and owner-only from the moment it exists, so the secret is
 * never briefly world-readable.
 */
export async function publishStore(host: Host, opened: OpenedStore, bytes: Buffer): Promise<void> {
  if (!sameBytes(await readStoreBytes(host, opened.path), opened.bytes)) {
    throw conflict(`${opened.path} changed while it was open; nothing was written — run the command again`);
  }
  const temp = tempName(opened.path);
  await host.writeFileMode(temp, new Uint8Array(bytes), 0o600);
  await host.rename(temp, opened.path);
  await host.chmodOwnerOnly(opened.path);
}
