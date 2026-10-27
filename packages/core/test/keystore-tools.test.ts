import { describe, expect, it } from 'vitest';

import { encodePublic, encodeSecret, generateKeyPair, open as openKeystore } from '@gimlet-eye/engine';
import { pathsUnder } from '../src/paths.js';
import { defaultConfig } from '../src/config.js';
import { generateKey } from '../src/tools/keys.js';
import { keyExport, keyImport, keyList, keyRotate } from '../src/tools/keystore-tools.js';
import { fakeHost, type FakeHost } from './fake-host.js';

type Store = Map<string, Buffer>;

function host(initial: Record<string, string> = {}): FakeHost & { store: Store } {
  const fake = fakeHost() as FakeHost & { store: Store };
  const store: Store = new Map();
  for (const [path, value] of Object.entries(initial)) store.set(path, Buffer.from(value, 'utf8'));
  fake.store = store;
  fake.exists = async (path: string) => store.has(path);
  fake.readFile = async (path: string) => {
    const value = store.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return new Uint8Array(value);
  };
  fake.readTextFile = async (path: string) => {
    const value = store.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value.toString('utf8');
  };
  fake.writeFile = async (path: string, bytes: Uint8Array) => store.set(path, Buffer.from(bytes));
  fake.writeTextFile = async (path: string, text: string) => store.set(path, Buffer.from(text, 'utf8'));
  fake.rename = async (from: string, to: string) => {
    const value = store.get(from);
    if (value === undefined) throw new Error(`ENOENT: ${from}`);
    store.delete(from);
    store.set(to, value);
  };
  fake.chmodOwnerOnly = async () => undefined;
  fake.createDir = async () => undefined;
  return fake;
}

const ROOT = '/home/tester/.gimlet';
const ctxFor = (fake: FakeHost, dryRun = false) => ({ host: fake, config: defaultConfig(), dryRun, paths: pathsUnder(ROOT) });

describe('the keystore tools, in process', () => {
  it('lists what is in the store, or says there is none', async () => {
    const fake = host();
    await expect(keyList.run(ctxFor(fake), { passphrase: 'pw' })).rejects.toThrow(/crypto.keygen keystore=true/);

    await generateKey.run(ctxFor(fake), { label: 'work', keystore: true, passphrase: 'pw' });
    await generateKey.run(ctxFor(fake), { label: 'alice', kind: 'x25519', keystore: true, passphrase: 'pw' });

    const report = await keyList.run(ctxFor(fake), { passphrase: 'pw' });
    const data = report.data as { count: number; keys: { label: string; kind: string }[] };
    expect(data.count).toBe(2);
    expect(data.keys.map((key) => `${key.label}:${key.kind}`)).toEqual(['work:ed25519', 'alice:x25519']);
    expect(report.summary).toBe('2 key(s): 1 signing, 1 recipient(s)');
  });

  it('refuses a wrong passphrase before parsing anything', async () => {
    const fake = host();
    await generateKey.run(ctxFor(fake), { label: 'work', keystore: true, passphrase: 'pw' });
    await expect(keyList.run(ctxFor(fake), { passphrase: 'nope' })).rejects.toThrow(/damaged file|could not be read/);
  });

  it('imports a key file, defaulting the label to its stem', async () => {
    const pair = generateKeyPair('ed25519');
    const fake = host({ '/keys/from-disk.key': encodeSecret(pair) });

    const report = await keyImport.run(ctxFor(fake), { key: '/keys/from-disk.key', passphrase: 'pw' });
    expect((report.data as { label: string }).label).toBe('from-disk');
    expect((report.data as { has_secret: boolean }).has_secret).toBe(true);

    const listed = await keyList.run(ctxFor(fake), { passphrase: 'pw' });
    expect((listed.data as { count: number }).count).toBe(1);
  });

  it('imports only the public half when asked, and refuses a duplicate label', async () => {
    const pair = generateKeyPair('ed25519');
    const fake = host({ '/keys/a.pub': encodePublic(pair), '/keys/b.pub': encodePublic(pair) });

    await keyImport.run(ctxFor(fake), { key: '/keys/a.pub', label: 'peer', public_only: true, passphrase: 'pw' });
    const listed = await keyList.run(ctxFor(fake), { passphrase: 'pw' });
    expect((listed.data as { keys: { id: string }[] }).keys[0]?.id).toBeTruthy();

    await expect(
      keyImport.run(ctxFor(fake), { key: '/keys/b.pub', label: 'peer', public_only: true, passphrase: 'pw' }),
    ).rejects.toThrow(/already exists/);

    // replace=true is the documented way out.
    await keyImport.run(ctxFor(fake), { key: '/keys/b.pub', label: 'peer', public_only: true, replace: true, passphrase: 'pw' });
    expect((await keyList.run(ctxFor(fake), { passphrase: 'pw' })).data).toMatchObject({ count: 1 });
  });

  it('exports the public half by default and the secret only on request', async () => {
    const fake = host();
    await generateKey.run(ctxFor(fake), { label: 'work', keystore: true, passphrase: 'pw' });

    await keyExport.run(ctxFor(fake), { selector: 'work', output: '/out/work.pub', passphrase: 'pw' });
    const publicFile = JSON.parse(fake.store.get('/out/work.pub')?.toString('utf8') ?? '{}');
    expect(publicFile.secret_key).toBeUndefined();

    await keyExport.run(ctxFor(fake), { selector: 'work', output: '/out/work.key', secret: true, passphrase: 'pw' });
    const secretFile = JSON.parse(fake.store.get('/out/work.key')?.toString('utf8') ?? '{}');
    expect(secretFile.secret_key).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      keyExport.run(ctxFor(fake), { selector: 'work', output: '/out/work.pub', passphrase: 'pw' }),
    ).rejects.toThrow(/already exists/);
  });

  it('rotates the passphrase without regenerating anything', async () => {
    const fake = host();
    await generateKey.run(ctxFor(fake), { label: 'work', keystore: true, passphrase: 'old' });
    const before = openKeystore(fake.store.get(`${ROOT}/keystore.gimlet`) as Buffer, 'old');
    const publicBefore = before.entries[0]?.public_key;

    const report = await keyRotate.run(ctxFor(fake), { passphrase: 'old', new_passphrase: 'new' });
    expect((report.data as { keys: number }).keys).toBe(1);

    await expect(keyList.run(ctxFor(fake), { passphrase: 'old' })).rejects.toThrow();
    const after = openKeystore(fake.store.get(`${ROOT}/keystore.gimlet`) as Buffer, 'new');
    expect(after.entries[0]?.public_key).toBe(publicBefore);
  });

  it('needs both passphrases for rotation', async () => {
    const fake = host();
    await generateKey.run(ctxFor(fake), { label: 'work', keystore: true, passphrase: 'old' });
    await expect(keyRotate.run(ctxFor(fake), { passphrase: 'old' })).rejects.toThrow(/new passphrase/);
    await expect(keyRotate.run(ctxFor(fake), { new_passphrase: 'new' })).rejects.toThrow(/needs a passphrase/);
  });

  it('writes nothing on a dry run', async () => {
    const pair = generateKeyPair('ed25519');
    const fake = host({ '/keys/a.key': encodeSecret(pair) });
    const report = await keyImport.run(ctxFor(fake, true), { key: '/keys/a.key', passphrase: 'pw' });
    expect((report.data as { dry_run: boolean }).dry_run).toBe(true);
    expect(fake.store.has(`${ROOT}/keystore.gimlet`)).toBe(false);
  });
});
