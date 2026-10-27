import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { decryptedPath, decryptFile, encryptFile } from '../src/tools/containers.js';
import { defaultConfig } from '../src/config.js';
import { fakeHost, type FakeHost } from './fake-host.js';

const ctxFor = (host: FakeHost) => ({ host, config: defaultConfig(), dryRun: false });

/**
 * A host holding real bytes.
 *
 * The fake host now keeps bytes and text separately, so this only has to seed
 * the byte map — and exposing it lets a test read back what a tool wrote, which
 * is the only way to check a container's framing.
 */
function binaryHost(initial: Record<string, Buffer | string>): FakeHost {
  const host = fakeHost();
  for (const [path, value] of Object.entries(initial)) {
    host.fileBytes.set(path, Buffer.isBuffer(value) ? value : Buffer.from(value));
  }
  (host as FakeHost & { bytes: Map<string, Buffer> }).bytes = host.fileBytes;
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

describe('a container that asks for more work than the tool will do', () => {
  /** A real container with its KDF cost fields rewritten, exactly as a hostile
   * file would arrive: the header is authenticated, so this also proves the
   * refusal happens *before* the key is derived. */
  function withCost(memoryKib: number, timeCost: number): FakeHost {
    const host = binaryHost({ '/notes.txt': 'the quick brown fox\n' });
    return host;
  }

  async function sealedWith(memoryKib?: number, timeCost?: number): Promise<Buffer> {
    const host = withCost(0, 0);
    await encryptFile.run(ctxFor(host), { input: '/notes.txt', output: '/notes.gimlet', passphrase: 'pw' });
    const sealed = Buffer.from((host as FakeHost & { bytes: Map<string, Buffer> }).bytes.get('/notes.gimlet')!);
    // Header: magic(4) version cipher kdf reserved, then m_cost(u32) at 8,
    // t_cost(u32) at 12, lanes at 16.
    if (memoryKib !== undefined) sealed.writeUInt32LE(memoryKib, 8);
    if (timeCost !== undefined) sealed.writeUInt32LE(timeCost, 12);
    return sealed;
  }

  it('refuses an expensive header before deriving anything', async () => {
    const sealed = await sealedWith(512 * 1024, 8);
    const host = binaryHost({ '/notes.gimlet': sealed });

    const started = Date.now();
    await expect(
      decryptFile.run(ctxFor(host), { input: '/notes.gimlet', passphrase: 'pw' }),
    ).rejects.toThrow(/more than this tool will spend unasked/);
    // 512 MiB and eight passes would take far longer than this to derive.
    expect(Date.now() - started).toBeLessThan(2000);

    // Each dimension is checked on its own: 64 MiB is well inside the memory
    // budget, and eight passes is what makes this one expensive.
    const passes = await sealedWith(64 * 1024, 8);
    await expect(
      decryptFile.run(ctxFor(binaryHost({ '/notes.gimlet': passes })), { input: '/notes.gimlet', passphrase: 'pw' }),
    ).rejects.toThrow(/more than this tool will spend unasked/);
  });

  // Deriving Argon2id over 257 MiB takes seconds on a loaded machine, which is
  // the point of the guard; the timeout says so rather than flaking at 5s.
  it('suggests both ways forward, and honours the one that says yes', { timeout: 30_000 }, async () => {
    // Just over the budget (300 MiB, one pass) so the "yes" path really does
    // derive rather than being asserted from a message: it is slow enough to be
    // outside the budget and fast enough to run in a test.
    const sealed = await sealedWith(257 * 1024, 1);
    const host = binaryHost({ '/notes.gimlet': sealed });

    await expect(decryptFile.run(ctxFor(host), { input: '/notes.gimlet', passphrase: 'pw' })).rejects.toThrow(
      /allow_expensive=true.*crypto\.inspect/,
    );

    // allow_expensive gets past the refusal and on to the tag check, which fails
    // here because the header was tampered with — the point is that the budget
    // was what stood in the way, not the encryption.
    await expect(
      decryptFile.run(ctxFor(host), { input: '/notes.gimlet', passphrase: 'pw', allow_expensive: true }),
    ).rejects.toThrow(/tag|authenticat|decrypt|unable/i);
  });

  it('accepts the parameters this build writes without being asked', async () => {
    const sealed = await sealedWith();
    const host = binaryHost({ '/notes.gimlet': sealed });

    const report = await decryptFile.run(ctxFor(host), { input: '/notes.gimlet', passphrase: 'pw' });
    expect(report.status).toBe('ok');
  });
});

describe('writing over the input', () => {
  it('refuses to encrypt a file onto itself', async () => {
    const host = binaryHost({ '/notes.txt': 'the quick brown fox\n' });
    await expect(
      encryptFile.run(ctxFor(host), { input: '/notes.txt', output: '/notes.txt', overwrite: true, passphrase: 'pw' }),
    ).rejects.toThrow(/is the input file; choose another path/);
    // Nothing was written: the plaintext is still the plaintext.
    expect((host as FakeHost & { bytes: Map<string, Buffer> }).bytes.get('/notes.txt')!.toString()).toBe(
      'the quick brown fox\n',
    );
  });

  it('refuses a spelling of the input that is not character-identical', async () => {
    const host = binaryHost({ '/work/notes.txt': 'x' });
    await expect(
      encryptFile.run(ctxFor(host), { input: '/work/notes.txt', output: '/work/./notes.txt', passphrase: 'pw' }),
    ).rejects.toThrow(/is the input file/);
  });

  it('refuses to decrypt a container onto itself', async () => {
    const host = binaryHost({ '/notes.txt': 'data\n' });
    await encryptFile.run(ctxFor(host), { input: '/notes.txt', output: '/notes.gimlet', passphrase: 'pw' });

    await expect(
      decryptFile.run(ctxFor(host), { input: '/notes.gimlet', output: '/notes.gimlet', overwrite: true, passphrase: 'pw' }),
    ).rejects.toThrow(/is the input file; choose another path/);
    // The container is intact, so it can still be opened.
    const again = await decryptFile.run(ctxFor(host), { input: '/notes.gimlet', output: '/out.txt', passphrase: 'pw' });
    expect(again.status).toBe('ok');
  });
});

describe('streaming a large file', () => {
  it('bounds every read and write, however large the input', { timeout: 60_000 }, async () => {
    // 8 MiB is 128 chunks: enough that a whole-file implementation would show up
    // as a single 8 MiB read and an 8 MiB write.
    const size = 8 * 1024 * 1024;
    const plaintext = Buffer.alloc(size, 0x5a);
    const host = binaryHost({ '/big.bin': plaintext });

    await encryptFile.run(ctxFor(host), { input: '/big.bin', output: '/big.gimlet', passphrase: 'pw' });

    // The window, and one frame of framing plus tag on top of a chunk.
    expect(Math.max(...host.reads)).toBeLessThanOrEqual(1024 * 1024);
    expect(Math.max(...host.writes)).toBeLessThanOrEqual(64 * 1024 + 16 + 5);

    const sealReads = [...host.reads];
    const sealWrites = [...host.writes];
    await decryptFile.run(ctxFor(host), { input: '/big.gimlet', output: '/big.out', passphrase: 'pw' });

    // Decryption emits whatever the window completed — up to one window — so the
    // bound is the window either way, and never the file.
    expect(Math.max(...host.reads.slice(sealReads.length))).toBeLessThanOrEqual(1024 * 1024);
    expect(Math.max(...host.writes.slice(sealWrites.length))).toBeLessThanOrEqual(1024 * 1024);
    expect(bytesOf(host).get('/big.out')?.equals(plaintext)).toBe(true);
  });

  it('counts the chunks it wrote', { timeout: 30_000 }, async () => {
    const host = binaryHost({ '/small.bin': Buffer.alloc(64 * 1024, 1) });
    const report = await encryptFile.run(ctxFor(host), { input: '/small.bin', output: '/small.gimlet', passphrase: 'pw' });
    // Exactly one full chunk is one chunk, not two: the final flag rides on it.
    expect((report.data as { container_bytes: number }).container_bytes).toBe(49 + 5 + 64 * 1024 + 16);
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
