import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { decryptedPath, decryptFile, encryptFile } from '../src/tools/containers.js';
import { defaultConfig } from '../src/config.js';
import { fakeHost, type FakeHost } from './fake-host.js';

const ctxFor = (host: FakeHost) => ({ host, config: defaultConfig(), dryRun: false });

/** A host with real bytes and a working write path, which the fake cannot do for binary. */
function binaryHost(initial: Record<string, Buffer | string>): FakeHost {
  const host = fakeHost();
  const files = new Map<string, Buffer>();
  for (const [path, value] of Object.entries(initial)) {
    files.set(path, Buffer.isBuffer(value) ? value : Buffer.from(value));
  }

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
  host.writeFile = async (path: string, bytes: Uint8Array) => {
    files.set(path, Buffer.from(bytes));
  };
  host.writeTextFile = async (path: string, text: string) => {
    files.set(path, Buffer.from(text, 'utf8'));
  };
  // Expose the bytes so a test can inspect what was written.
  (host as FakeHost & { bytes: Map<string, Buffer> }).bytes = files;
  return host;
}

const bytesOf = (host: FakeHost): Map<string, Buffer> => (host as FakeHost & { bytes: Map<string, Buffer> }).bytes;

const fixture = (name: string): Buffer => readFileSync(new URL(`../../engine/test/fixtures/${name}`, import.meta.url));

describe('crypto.encrypt / crypto.decrypt, in process', () => {
  const PASSPHRASE = { passphrase: 'correct horse battery staple' };

  it('round-trips a file through the default output names', async () => {
    const original = Buffer.from('notes that should not leak\n');
    const host = binaryHost({ '/work/notes.txt': original });

    const encrypted = await encryptFile.run(ctxFor(host), { input: '/work/notes.txt', ...PASSPHRASE });
    const data = encrypted.data as { output: string; kdf: string };
    expect(data.output).toBe('/work/notes.txt.gimlet');
    expect(data.kdf).toBe('argon2id');
    expect(bytesOf(host).has('/work/notes.txt.gimlet')).toBe(true);

    bytesOf(host).delete('/work/notes.txt');
    const decrypted = await decryptFile.run(ctxFor(host), { input: '/work/notes.txt.gimlet', ...PASSPHRASE });
    expect((decrypted.data as { output: string }).output).toBe('/work/notes.txt');
    expect(bytesOf(host).get('/work/notes.txt')?.equals(original)).toBe(true);
  });

  it('opens the version 1 container written by 0.2.0', async () => {
    const host = binaryHost({ '/work/old.melv': fixture('container-v1.melv') });
    const report = await decryptFile.run(ctxFor(host), {
      input: '/work/old.melv',
      passphrase: 'correct horse battery staple',
    });
    expect(bytesOf(host).get('/work/old')?.toString('utf8')).toBe(
      'a container written by 0.2.0: whole-file AEAD, version 1\n',
    );
    expect((report.data as { container_version: number }).container_version).toBe(1);
    expect((report.data as { chunks: number }).chunks).toBe(1);
  });

  it('opens the version 3 container with a recipient key, and refuses a passphrase', async () => {
    const secret = Buffer.alloc(32, 3);
    const keyFile = JSON.stringify({
      algorithm: 'x25519',
      public_key: '00'.repeat(32),
      secret_key: secret.toString('hex'),
    });
    const host = binaryHost({
      '/work/for-a-key.melv': fixture('container-v3.melv'),
      '/keys/a.key': keyFile,
    });

    await expect(
      decryptFile.run(ctxFor(host), { input: '/work/for-a-key.melv', ...PASSPHRASE }),
    ).rejects.toThrow(/version 3 container: pass key=/);

    const report = await decryptFile.run(ctxFor(host), { input: '/work/for-a-key.melv', key: '/keys/a.key' });
    expect((report.data as { container_version: number }).container_version).toBe(3);
    expect(bytesOf(host).get('/work/for-a-key')?.toString('utf8')).toBe(
      'a container written by 0.5.0: x25519 recipient, version 3\n',
    );
  });

  it('writes a version 3 container when given recipient keys', async () => {
    const host = binaryHost({ '/work/notes.txt': Buffer.from('for two keys') });
    const { generateRecipientKey, encodePublic } = await import('@gimlet-eye/engine');
    const alice = generateRecipientKey();

    const report = await encryptFile.run(ctxFor(host), {
      input: '/work/notes.txt',
      to: alice.public.toString('hex'),
      output: '/work/sealed.gimlet',
    });
    expect((report.data as { kdf: string }).kdf).toBe('x25519-hkdf-sha256');
    expect((report.data as { recipients: number }).recipients).toBe(1);

    const opened = await decryptFile.run(ctxFor(host), {
      input: '/work/sealed.gimlet',
      key: '/keys/alice.key',
      output: '/work/opened.txt',
    }).catch(async (error: Error) => {
      // The key file does not exist yet: write it and retry, which also proves
      // the tool reads a key file rather than taking a hex argument.
      if (!/not found/.test(error.message)) throw error;
      bytesOf(host).set(
        '/keys/alice.key',
        Buffer.from(JSON.stringify({ algorithm: 'x25519', public_key: alice.public.toString('hex'), secret_key: alice.secret.toString('hex') })),
      );
      return decryptFile.run(ctxFor(host), {
        input: '/work/sealed.gimlet',
        key: '/keys/alice.key',
        output: '/work/opened.txt',
      });
    });
    void opened;
    expect(bytesOf(host).get('/work/opened.txt')?.toString('utf8')).toBe('for two keys');
    void encodePublic;
  });

  it('never replaces a file without overwrite=true', async () => {
    const host = binaryHost({ '/work/notes.txt': Buffer.from('x'), '/work/notes.txt.gimlet': Buffer.from('old') });
    await expect(
      encryptFile.run(ctxFor(host), { input: '/work/notes.txt', ...PASSPHRASE }),
    ).rejects.toThrow(/already exists/);
    await encryptFile.run(ctxFor(host), { input: '/work/notes.txt', overwrite: true, ...PASSPHRASE });
    expect(bytesOf(host).get('/work/notes.txt.gimlet')?.subarray(0, 4).toString('latin1')).toBe('GIML');
  });

  it('writes nothing on a dry run', async () => {
    const host = binaryHost({ '/work/notes.txt': Buffer.from('x') });
    const report = await encryptFile.run({ ...ctxFor(host), dryRun: true }, { input: '/work/notes.txt', ...PASSPHRASE });
    expect((report.data as { output: string | null }).output).toBeNull();
    expect(bytesOf(host).has('/work/notes.txt.gimlet')).toBe(false);
  });

  it('reads the passphrase from the environment by preference', async () => {
    const host = binaryHost({ '/work/notes.txt': Buffer.from('env') });
    process.env['GIMLET_TEST_PASS'] = 'from-env';
    try {
      await encryptFile.run(ctxFor(host), { input: '/work/notes.txt', passphrase_env: 'GIMLET_TEST_PASS' });
      const report = await decryptFile.run(ctxFor(host), {
        input: '/work/notes.txt.gimlet',
        passphrase_env: 'GIMLET_TEST_PASS',
        output: '/work/back.txt',
      });
      expect(report.status).toBe('ok');
    } finally {
      delete process.env['GIMLET_TEST_PASS'];
    }
  });

  it('says when the environment variable is missing', async () => {
    const host = binaryHost({ '/work/notes.txt': Buffer.from('x') });
    await expect(
      encryptFile.run(ctxFor(host), { input: '/work/notes.txt', passphrase_env: 'NOT_SET_ANYWHERE' }),
    ).rejects.toThrow(/NOT_SET_ANYWHERE/);
  });
});

describe('the decrypt output name', () => {
  it('strips a container suffix and falls back to .decrypted', () => {
    expect(decryptedPath('/a/b.txt.gimlet')).toBe('/a/b.txt');
    expect(decryptedPath('/a/b.melv')).toBe('/a/b');
    expect(decryptedPath('/a/b.bin')).toBe('/a/b.decrypted');
    expect(decryptedPath('/a/b')).toBe('/a/b.decrypted');
  });
});
