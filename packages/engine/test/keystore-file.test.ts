/**
 * The keystore on a real filesystem.
 *
 * Every other keystore test drives a fake host, which is the right way to check
 * the tools but says nothing about the file that ends up on disk — the fake
 * stubs `chmodOwnerOnly` out. That gap was real: changing the mode written by
 * `save()` from `0600` to `0644` passed the whole suite.
 *
 * A keystore holds every private key the user has. Its mode, its atomicity, and
 * what a failure leaves behind are the security properties, so they are checked
 * against Node's own filesystem rather than against a stub.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nodeHost } from '@gimlet-eye/core/host-node';
import { createEntry, insert, load, KEYSTORE_FILE, newId, open, save, SCHEMA_VERSION, seal } from '../src/keystore.js';
import { generateKeyPair } from '../src/keys.js';
import type { Keystore } from '../src/keystore.js';

const PASSPHRASE = 'a real passphrase';

let work: string;
let store: Keystore;

/** The permissions bits of a path, as `ls -l` would show them. */
function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
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
    await save(path, PASSPHRASE, store);

    expect(modeOf(path)).toBe(0o600);
  });

  it('stays owner-only when it is rewritten over an existing file', async () => {
    const path = join(work, KEYSTORE_FILE);
    await save(path, PASSPHRASE, store);

    const withKey = insert(store, createEntry(generateKeyPair('ed25519'), 'work', '2026-01-01T00:00:00Z'));
    await save(path, PASSPHRASE, withKey);

    expect(modeOf(path)).toBe(0o600);
    expect(open(readFileSync(path), PASSPHRASE).entries.map((entry) => entry.label)).toEqual(['work']);
  });

  it('does not widen a file that was already restrictive', async () => {
    // A user who tightened the file themselves should keep their setting when
    // the tool rewrites it — `save` re-applies 0600, never a looser mode.
    const path = join(work, KEYSTORE_FILE);
    await save(path, PASSPHRASE, store);
    chmodSync(path, 0o400);

    await save(path, PASSPHRASE, insert(store, createEntry(generateKeyPair('ed25519'), 'a', '2026-01-01T00:00:00Z')));

    expect(modeOf(path) & 0o077).toBe(0);
  });

  it('leaves no temporary file behind, and nothing readable by anyone else', async () => {
    const path = join(work, KEYSTORE_FILE);
    await save(path, PASSPHRASE, store);

    expect(readdirSync(work)).toEqual([KEYSTORE_FILE]);
    // Checked across the whole directory, so a future helper that writes beside
    // the keystore cannot quietly be looser than the keystore.
    for (const name of readdirSync(work)) {
      expect(modeOf(join(work, name)) & 0o077, name).toBe(0);
    }
  });

  it('creates the directory it is told to live in', async () => {
    const path = join(work, 'nested', 'deeper', KEYSTORE_FILE);
    await save(path, PASSPHRASE, store);

    expect(existsSync(path)).toBe(true);
    expect(modeOf(path)).toBe(0o600);
  });

  it('round-trips through load, and refuses the wrong passphrase', async () => {
    const path = join(work, KEYSTORE_FILE);
    const pair = generateKeyPair('x25519');
    await save(path, PASSPHRASE, insert(store, createEntry(pair, 'alice', '2026-01-01T00:00:00Z')));

    const loaded = await load(path, PASSPHRASE);
    expect(loaded.entries[0]?.label).toBe('alice');
    expect(loaded.entries[0]?.public_key).toHaveLength(64);

    await expect(load(path, 'not the passphrase')).rejects.toThrow();
  });

  it('says how to make one when there is none', async () => {
    await expect(load(join(work, KEYSTORE_FILE), PASSPHRASE)).rejects.toThrow(
      /no keystore at .*crypto\.keygen keystore=true/,
    );
  });

  it('does not leave a temp file when the write fails', async () => {
    // A directory where the temporary file must go, so the write cannot succeed.
    const path = join(work, KEYSTORE_FILE);
    mkdirSync(`${path}.tmp`, { recursive: true });

    await expect(save(path, PASSPHRASE, store)).rejects.toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it('is not readable as JSON', async () => {
    const path = join(work, KEYSTORE_FILE);
    await save(path, PASSPHRASE, store);
    const bytes = readFileSync(path);

    expect(() => JSON.parse(bytes.toString('utf8'))).toThrow();
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('GIML');
  });

  it('uses an id that is not guessable from a counter', () => {
    const ids = new Set(Array.from({ length: 64 }, () => newId()));
    expect(ids.size).toBe(64);
    expect(seal(store, PASSPHRASE).length).toBeGreaterThan(0);
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
