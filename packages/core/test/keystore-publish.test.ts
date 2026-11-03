/**
 * The keystore on a real filesystem, through the writer that actually runs.
 *
 * Every other keystore test drives a fake host, which is the right way to check
 * the tools but says nothing about the file that ends up on disk — the fake
 * stubs `chmodOwnerOnly` out. That gap was real: changing the mode written by
 * the old engine-level `save()` from `0600` to `0644` passed the whole suite.
 *
 * A keystore holds every private key the user has. Its mode, its atomicity, and
 * what a failure leaves behind are the security properties, so they are checked
 * against Node's own filesystem rather than against a stub. The assertions live
 * here, beside `publishStore`, because that is the only code that writes the
 * file.
 */

import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEntry, generateKeyPair, insert, KEYSTORE_FILE, open, SCHEMA_VERSION, seal } from '@gimlet-works/engine';
import { nodeHost } from '../src/host-node.js';
import { publishStore, readStoreBytes } from '../src/tools/store-file.js';
import type { Keystore } from '@gimlet-works/engine';

const PASSPHRASE = 'a real passphrase';

let work: string;
let store: Keystore;

/** The permissions bits of a path, as `ls -l` would show them. */
function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

/** Publish a store the way a tool does: the bytes it opened, then the write. */
async function publish(path: string, next: Keystore): Promise<void> {
  const host = nodeHost();
  await publishStore(host, { path, bytes: await readStoreBytes(host, path) }, seal(next, PASSPHRASE));
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'gimlet-keystore-'));
  store = { schema_version: SCHEMA_VERSION, entries: [] };
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('the keystore file', () => {
  it('is written owner-only', async () => {
    const path = join(work, KEYSTORE_FILE);
    await publish(path, store);

    expect(modeOf(path)).toBe(0o600);
  });

  it('stays owner-only when it is rewritten over an existing file', async () => {
    const path = join(work, KEYSTORE_FILE);
    await publish(path, store);

    const withKey = insert(store, createEntry(generateKeyPair('ed25519'), 'work', '2026-01-01T00:00:00Z'));
    await publish(path, withKey);

    expect(modeOf(path)).toBe(0o600);
    expect(open(readFileSync(path), PASSPHRASE).entries.map((entry) => entry.label)).toEqual(['work']);
  });

  it('does not widen a file that was already restrictive', async () => {
    // A user who tightened the file themselves keeps their setting when the tool
    // rewrites it — publishing re-applies 0600, never a looser mode.
    const path = join(work, KEYSTORE_FILE);
    await publish(path, store);
    chmodSync(path, 0o400);

    await publish(path, insert(store, createEntry(generateKeyPair('ed25519'), 'a', '2026-01-01T00:00:00Z')));

    expect(modeOf(path) & 0o077).toBe(0);
  });

  it('leaves no temporary file behind, and nothing readable by anyone else', async () => {
    const path = join(work, KEYSTORE_FILE);
    await publish(path, store);

    expect(readdirSync(work)).toEqual([KEYSTORE_FILE]);
    // Checked across the whole directory, so a future helper that writes beside
    // the keystore cannot quietly be looser than the keystore.
    for (const name of readdirSync(work)) {
      expect(modeOf(join(work, name)) & 0o077, name).toBe(0);
    }
  });

  it('does not leave a temp file when the write fails', async () => {
    // A parent directory the writer cannot create a sibling in.
    const directory = join(work, 'locked');
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o500);

    try {
      await expect(publish(join(directory, KEYSTORE_FILE), store)).rejects.toThrow();
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      chmodSync(directory, 0o700);
    }
  });

  it('refuses to publish over a store that changed while it was open', async () => {
    // The lost-update failure a key store cannot have: a second session sealed
    // the store between the read and the write.
    const path = join(work, KEYSTORE_FILE);
    await publish(path, store);
    const host = nodeHost();
    const opened = await readStoreBytes(host, path);

    await publish(path, insert(store, createEntry(generateKeyPair('ed25519'), 'theirs', '2026-01-01T00:00:00Z')));

    await expect(
      publishStore(host, { path, bytes: opened }, seal(insert(store, createEntry(generateKeyPair('ed25519'), 'ours', '2026-01-01T00:00:00Z')), PASSPHRASE)),
    ).rejects.toThrow(/changed while it was open/);
    expect(open(readFileSync(path), PASSPHRASE).entries.map((entry) => entry.label)).toEqual(['theirs']);
  });

  it('is not readable as JSON', async () => {
    const path = join(work, KEYSTORE_FILE);
    await publish(path, store);
    const bytes = readFileSync(path);

    expect(() => JSON.parse(bytes.toString('utf8'))).toThrow();
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('GIML');
  });
});

describe("the host's owner-only mode", () => {
  it('narrows a file that was created world-readable', async () => {
    const path = join(work, 'secret.key');
    writeFileSync(path, 'secret', { mode: 0o644 });
    expect(modeOf(path)).toBe(0o644);

    await nodeHost().chmodOwnerOnly(path);

    expect(modeOf(path)).toBe(0o600);
  });
});
