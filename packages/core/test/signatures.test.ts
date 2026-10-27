import { describe, expect, it } from 'vitest';

import { encodePublic, encodeSecret, generateKeyPair } from '@gimlet-eye/engine';

import { defaultConfig } from '../src/config.js';
import { signFile, verifyFile } from '../src/tools/signatures.js';
import { fakeHost, type FakeHost } from './fake-host.js';

const ctxFor = (host: FakeHost) => ({ host, config: defaultConfig(), dryRun: false });

/**
 * A host holding real bytes, since the text-backed fake mangles binary.
 *
 * `bytes` is returned so a test can change a file *after* signing — the point of
 * the tamper case — instead of mutating a copy the reader never sees.
 */
function hostWith(bytes: Record<string, Buffer | string>): { host: FakeHost; bytes: Record<string, Buffer | string> } {
  const host = fakeHost();
  host.readFile = async (path: string) => {
    const value = bytes[path];
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return new Uint8Array(Buffer.isBuffer(value) ? value : Buffer.from(value));
  };
  host.readTextFile = async (path: string) => {
    const live = host.files.get(path);
    if (live !== undefined) return live;
    const value = bytes[path];
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return typeof value === 'string' ? value : value.toString('utf8');
  };
  host.exists = async (path: string) => path in bytes || host.files.has(path);
  return { host, bytes };
}

function keyed(message: Buffer) {
  const pair = generateKeyPair('ed25519');
  return {
    pair,
    ...hostWith({
      '/work/release.bin': message,
      '/keys/release.key': encodeSecret(pair),
      '/keys/release.pub': encodePublic(pair),
    }),
  };
}

describe('crypto.sign, in process', () => {
  it('writes a detached signature beside the file by default', async () => {
    const { host } = keyed(Buffer.from('release notes'));
    const report = await signFile.run(ctxFor(host), { input: '/work/release.bin', key: '/keys/release.key' });

    const data = report.data as { signature: string; algorithm: string; signature_hex: string };
    expect(data.signature).toBe('/work/release.bin.sig');
    expect(data.algorithm).toBe('ed25519');
    expect(host.files.get('/work/release.bin.sig')).toBe(data.signature_hex);
    expect(data.signature_hex).toMatch(/^[0-9a-f]{128}$/);
  });

  it('honours an explicit output and refuses to overwrite without it', async () => {
    const { host } = keyed(Buffer.from('x'));
    await signFile.run(ctxFor(host), { input: '/work/release.bin', key: '/keys/release.key', output: '/work/out.sig' });
    expect(host.files.has('/work/out.sig')).toBe(true);

    await expect(
      signFile.run(ctxFor(host), { input: '/work/release.bin', key: '/keys/release.key', output: '/work/out.sig' }),
    ).rejects.toThrow(/already exists/);
  });

  it('writes nothing on a dry run but still reports the signature', async () => {
    const { host } = keyed(Buffer.from('x'));
    const report = await signFile.run(
      { ...ctxFor(host), dryRun: true },
      { input: '/work/release.bin', key: '/keys/release.key' },
    );
    const data = report.data as { signature: string | null; signature_hex: string };
    expect(data.signature).toBeNull();
    expect(data.signature_hex).toMatch(/^[0-9a-f]{128}$/);
    expect(host.files.has('/work/release.bin.sig')).toBe(false);
  });

  it('says which input is missing', async () => {
    const { host } = keyed(Buffer.from('x'));
    await expect(signFile.run(ctxFor(host), { input: '/work/nope', key: '/keys/release.key' })).rejects.toThrow(
      /not found/,
    );
  });
});

describe('crypto.verify, in process', () => {
  it('verifies a signature this build produced', async () => {
    const { host } = keyed(Buffer.from('release notes'));
    await signFile.run(ctxFor(host), { input: '/work/release.bin', key: '/keys/release.key' });

    const report = await verifyFile.run(ctxFor(host), {
      input: '/work/release.bin',
      signature: '/work/release.bin.sig',
      key: '/keys/release.pub',
    });
    expect(report.status).toBe('ok');
    expect((report.data as { valid: boolean }).valid).toBe(true);
    expect(report.findings ?? []).toEqual([]);
  });

  it('fails a file that changed after signing', async () => {
    const { host, bytes } = keyed(Buffer.from('release notes'));
    await signFile.run(ctxFor(host), { input: '/work/release.bin', key: '/keys/release.key' });
    bytes['/work/release.bin'] = Buffer.from('released notez');

    const report = await verifyFile.run(ctxFor(host), {
      input: '/work/release.bin',
      signature: '/work/release.bin.sig',
      key: '/keys/release.pub',
    });
    expect(report.status).toBe('error');
    expect((report.data as { valid: boolean }).valid).toBe(false);
    expect(report.findings?.[0]?.code).toBe('crypto.signature_invalid');
    expect(report.findings?.[0]?.severity).toBe('high');
  });

  it('refuses a signature file that is not 64 bytes of hex', async () => {
    const { host } = keyed(Buffer.from('x'));
    host.files.set('/work/short.sig', 'abcd');
    await expect(
      verifyFile.run(ctxFor(host), {
        input: '/work/release.bin',
        signature: '/work/short.sig',
        key: '/keys/release.pub',
      }),
    ).rejects.toThrow(/64-byte signature/);
  });
});
