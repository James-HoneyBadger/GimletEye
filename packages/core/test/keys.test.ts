import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { hexDecodeExact, open as openKeystore, SCHEMA_VERSION } from '@gimlet-eye/engine';
import { pathsUnder } from '../src/paths.js';
import { defaultConfig } from '../src/config.js';
import { NODE_TOOLS } from '../src/node.js';
import { Runtime } from '../src/runtime.js';
import { generateKey, inspectContainer } from '../src/tools/keys.js';
import { fakeHost, type FakeHost } from './fake-host.js';

const fixture = (name: string): Buffer => readFileSync(new URL(`../../engine/test/fixtures/${name}`, import.meta.url));

function binaryHost(initial: Record<string, Buffer | string>): FakeHost {
  const host = fakeHost();
  const files = new Map<string, Buffer>();
  for (const [path, value] of Object.entries(initial)) files.set(path, Buffer.isBuffer(value) ? value : Buffer.from(value));
  host.exists = async (path: string) => files.has(path);
  host.readFile = async (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return new Uint8Array(value);
  };
  host.readTextFile = async (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value.toString('utf8');
  };
  host.writeFile = async (path: string, bytes: Uint8Array) => files.set(path, Buffer.from(bytes));
  host.writeFileMode = async (path: string, bytes: Uint8Array, mode: number) => {
    files.set(path, Buffer.from(bytes));
    host.modes.set(path, mode);
  };
  host.writeTextFile = async (path: string, text: string) => files.set(path, Buffer.from(text, 'utf8'));
  host.createDir = async () => undefined;
  host.rename = async (from: string, to: string) => {
    const value = files.get(from);
    if (value === undefined) throw new Error(`ENOENT: ${from}`);
    files.delete(from);
    files.set(to, value);
  };
  host.chmodOwnerOnly = async () => undefined;
  (host as FakeHost & { bytes: Map<string, Buffer> }).bytes = files;
  return host;
}

const ctxFor = (host: FakeHost, root = '/home/tester/.gimlet', dryRun = false) => ({
  host,
  config: defaultConfig(),
  dryRun,
  paths: pathsUnder(root),
});

const bytesOf = (host: FakeHost): Map<string, Buffer> => (host as FakeHost & { bytes: Map<string, Buffer> }).bytes;

describe('crypto.inspect, in process', () => {
  it('names the cipher and parameters without decrypting', async () => {
    const host = binaryHost({ '/w/v1.melv': fixture('container-v1.melv'), '/w/v3.melv': fixture('container-v3.melv') });

    const v1 = await inspectContainer.run(ctxFor(host), { input: '/w/v1.melv' });
    expect((v1.data as { container_version: number }).container_version).toBe(1);
    expect((v1.data as { streaming: boolean }).streaming).toBe(false);
    expect(v1.summary).toContain('whole file');
    expect(v1.summary).toContain('argon2id');

    const v3 = await inspectContainer.run(ctxFor(host), { input: '/w/v3.melv' });
    expect((v3.data as { container_version: number }).container_version).toBe(3);
    expect((v3.data as { recipients: number }).recipients).toBe(1);
    expect(v3.summary).toContain('x25519-hkdf-sha256');
  });

  it('refuses a file that is not a container', async () => {
    const host = binaryHost({ '/w/plain.txt': Buffer.from('not a container') });
    await expect(inspectContainer.run(ctxFor(host), { input: '/w/plain.txt' })).rejects.toThrow(/bad magic|too short/);
  });
});

describe('crypto.keygen, in process', () => {
  it('writes <label>.key and <label>.pub', async () => {
    const host = binaryHost({});
    const report = await generateKey.run(ctxFor(host), { label: 'demo', dir: '/keys' });

    const data = report.data as { secret_path: string; public_path: string; kind: string; stored: string };
    expect(data.secret_path).toBe('/keys/demo.key');
    expect(data.public_path).toBe('/keys/demo.pub');
    expect(data.kind).toBe('ed25519');
    expect(data.stored).toBe('files');

    const secret = JSON.parse(bytesOf(host).get('/keys/demo.key')?.toString('utf8') ?? '{}');
    const publicFile = JSON.parse(bytesOf(host).get('/keys/demo.pub')?.toString('utf8') ?? '{}');
    expect(secret.algorithm).toBe('ed25519');
    expect(secret.secret_key).toMatch(/^[0-9a-f]{64}$/);
    expect(publicFile.secret_key).toBeUndefined();
    expect(publicFile.public_key).toBe(secret.public_key);
  });

  it('generates a recipient key when asked', async () => {
    const host = binaryHost({});
    await generateKey.run(ctxFor(host), { label: 'alice', dir: '/keys', kind: 'x25519' });
    const secret = JSON.parse(bytesOf(host).get('/keys/alice.key')?.toString('utf8') ?? '{}');
    expect(secret.algorithm).toBe('x25519');
  });

  it('never replaces an existing key file without overwrite', async () => {
    const host = binaryHost({ '/keys/demo.key': Buffer.from('keep me') });
    await expect(generateKey.run(ctxFor(host), { label: 'demo', dir: '/keys' })).rejects.toThrow(/already exists/);
    expect(bytesOf(host).get('/keys/demo.key')?.toString('utf8')).toBe('keep me');

    await generateKey.run(ctxFor(host), { label: 'demo', dir: '/keys', overwrite: true });
    expect(bytesOf(host).get('/keys/demo.key')?.toString('utf8')).not.toBe('keep me');
  });

  it('writes nothing on a dry run', async () => {
    const host = binaryHost({});
    const report = await generateKey.run(ctxFor(host, '/home/tester/.gimlet', true), { label: 'demo', dir: '/keys' });
    expect((report.data as { secret_path: string | null }).secret_path).toBeNull();
    expect(bytesOf(host).size).toBe(0);
  });

  it('seals the key into the keystore when asked, and the store opens', async () => {
    const host = binaryHost({});
    process.env['GIMLET_KG_PASS'] = 'store pass';
    try {
      const report = await generateKey.run(ctxFor(host), {
        label: 'work',
        keystore: true,
        passphrase_env: 'GIMLET_KG_PASS',
      });
      expect((report.data as { stored: string }).stored).toBe('keystore');

      const sealedBytes = bytesOf(host).get('/home/tester/.gimlet/keystore.gimlet');
      expect(sealedBytes?.subarray(0, 4).toString('latin1')).toBe('GIML');

      // The pure opener, because the bytes live in the fake host, not on disk.
      const store = openKeystore(sealedBytes as Buffer, 'store pass');
      expect(store.schema_version).toBe(SCHEMA_VERSION);
      expect(store.entries.map((entry) => entry.label)).toEqual(['work']);
      // The entry holds the raw key as hex, not a key-file document.
      expect(hexDecodeExact(store.entries[0]?.public_key ?? '', 32, 'public key')).toHaveLength(32);
    } finally {
      delete process.env['GIMLET_KG_PASS'];
    }
  });

  it('refuses a keystore write with no passphrase', async () => {
    const host = binaryHost({});
    await expect(generateKey.run(ctxFor(host), { label: 'x', keystore: true })).rejects.toThrow(/passphrase/);
  });
});

/**
 * The tests above call the tool directly. These go through `Runtime.run`, which
 * is the gate that compares the report with the declared schema — the gate the
 * file-writing path used to fail, unnoticed, for two releases.
 */
describe('crypto.keygen through the runtime', () => {
  async function runtimeFor(host: FakeHost): Promise<Runtime> {
    return Runtime.load(host, { home: '/home/tester/.gimlet', localTools: NODE_TOOLS });
  }

  it('accepts the report it returns when it writes key files', async () => {
    const host = binaryHost({});
    const runtime = await runtimeFor(host);

    const { report } = await runtime.run('crypto.keygen', { label: 'demo', dir: '/keys' });

    expect(report.status).toBe('ok');
    expect((report.data as { secret_path: string }).secret_path).toBe('/keys/demo.key');
    // Created owner-only rather than chmod'ed afterwards.
    expect(host.modes.get('/keys/demo.key')).toBe(0o600);
    runtime.close();
  });

  it('accepts the report it returns when it writes the keystore', async () => {
    const host = binaryHost({});
    const runtime = await runtimeFor(host);

    const { report } = await runtime.run('crypto.keygen', { label: 'demo', keystore: true, passphrase: 'pw' });

    expect(report.status).toBe('ok');
    expect((report.data as { stored: string }).stored).toBe('keystore');
    expect(typeof (report.data as { id: unknown }).id).toBe('string');
    runtime.close();
  });
});
