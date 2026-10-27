/**
 * The gpg pair, checked against a real gpg.
 *
 * Mocking `[GNUPG:]` output would only prove this file agrees with itself. The
 * interesting questions are whether a signature gpg actually made is accepted,
 * a file it did not sign is rejected, and a message this tool wrote is one gpg
 * can open — so the tests below run gpg for real in a throwaway keyring, and
 * skip when it is not installed.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nodeHost } from '../src/host-node.js';
import { defaultConfig } from '../src/config.js';
import { pathsUnder } from '../src/paths.js';
import { gpgEncrypt, gpgVerify } from '../src/tools/gpg.js';
import { fakeHost, type FakeHost } from './fake-host.js';

const RECIPIENT = 'Gimlet Test <test@example.invalid>';

const HAVE_GPG = (() => {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function gpg(homedir: string, args: readonly string[]): string {
  return execFileSync('gpg', ['--homedir', homedir, '--batch', '--no-tty', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe.skipIf(!HAVE_GPG)('the gpg tools, against a real gpg', () => {
  let home: string;
  let work: string;
  let fingerprint: string;
  let file: string;
  let signature: string;

  const ctxFor = (extra: { dryRun?: boolean } = {}) => ({
    host: nodeHost(),
    config: defaultConfig(),
    dryRun: extra.dryRun ?? false,
    paths: pathsUnder(join(work, 'gimlet')),
  });

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'gimlet-gpg-'));
    chmodSync(home, 0o700);
    work = mkdtempSync(join(tmpdir(), 'gimlet-gpg-work-'));

    gpg(home, [
      '--pinentry-mode',
      'loopback',
      '--passphrase',
      '',
      '--quick-generate-key',
      RECIPIENT,
      'ed25519',
      'cert,sign',
      '0',
    ]);

    // The fingerprint as gpg reports it, so the tool's answer is compared with
    // the keyring rather than with a string this test chose.
    const listing = gpg(home, ['--with-colons', '--fingerprint']);
    const line = listing.split('\n').find((each) => each.startsWith('fpr:'));
    fingerprint = (line ?? '').split(':')[9] ?? '';
    expect(fingerprint).toMatch(/^[0-9A-F]{40}$/);
    // A signature key cannot encrypt, and the encryption test needs a subkey.
    gpg(home, ['--pinentry-mode', 'loopback', '--passphrase', '', '--quick-add-key', fingerprint, 'cv25519', 'encr', '0']);

    file = join(work, 'letter.txt');
    writeFileSync(file, 'a letter that gpg will sign\n', 'utf8');
    signature = join(work, 'letter.txt.sig');
    gpg(home, ['--pinentry-mode', 'loopback', '--passphrase', '', '--output', signature, '--detach-sign', file]);
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });

  it('accepts a signature gpg made, and names the signer', async () => {
    const report = await gpgVerify.run(ctxFor(), { input: file, signature, homedir: home });
    const data = report.data as { valid: boolean; fingerprint: string; signer: string };
    expect(data.valid).toBe(true);
    expect(data.fingerprint).toBe(fingerprint);
    expect(data.signer).toContain('Gimlet Test');
    expect(report.summary).toContain(fingerprint.slice(0, 16));
  });

  it('rejects a file the signature was not made for', async () => {
    const tampered = join(work, 'tampered.txt');
    writeFileSync(tampered, 'a letter that gpg did not sign\n', 'utf8');
    await expect(gpgVerify.run(ctxFor(), { input: tampered, signature, homedir: home })).rejects.toThrow(
      /does not match the file/,
    );
  });

  it('reports a missing keyring entry as a missing key, not a bad signature', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gimlet-gpg-empty-'));
    chmodSync(empty, 0o700);
    try {
      await expect(gpgVerify.run(ctxFor(), { input: file, signature, homedir: empty })).rejects.toThrow(
        /is not in the keyring|no public key|not in the keyring/i,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('writes a message gpg can open', async () => {
    const plain = join(work, 'sealed.txt');
    writeFileSync(plain, 'the quick brown fox\n', 'utf8');
    const output = join(work, 'sealed.txt.gpg');

    const report = await gpgEncrypt.run(ctxFor(), { input: plain, recipient: RECIPIENT, output, homedir: home });
    const data = report.data as { output: string; output_bytes: number; backend: string };
    expect(data.output).toBe(output);
    expect(data.output_bytes).toBeGreaterThan(0);
    expect(data.backend).toBe('gpg');

    const roundTrip = execFileSync('gpg', ['--homedir', home, '--batch', '--decrypt', output], {
      encoding: 'utf8',
    });
    expect(roundTrip).toBe('the quick brown fox\n');
  });

  it('refuses to replace an existing output, and does nothing on a dry run', async () => {
    const plain = join(work, 'again.txt');
    writeFileSync(plain, 'again\n', 'utf8');
    const output = join(work, 'again.txt.gpg');
    writeFileSync(output, 'occupied', 'utf8');

    await expect(gpgEncrypt.run(ctxFor(), { input: plain, recipient: RECIPIENT, output, homedir: home })).rejects.toThrow(
      /already exists/,
    );
    expect(readFileSync(output, 'utf8')).toBe('occupied');

    const dry = await gpgEncrypt.run(ctxFor({ dryRun: true }), {
      input: plain,
      recipient: RECIPIENT,
      output,
      homedir: home,
    });
    expect(dry.data).toMatchObject({ output: null, output_bytes: 0, dry_run: true });
    expect(dry.summary).toContain('would encrypt');
    expect(readFileSync(output, 'utf8')).toBe('occupied');
  });
});

describe('the gpg tools, when gpg is not there', () => {
  const files = new Map([
    ['/data/letter.txt', Buffer.from('hello')],
    ['/data/letter.txt.sig', Buffer.from('signature')],
  ]);

  function host(): FakeHost {
    const fake = fakeHost();
    fake.exists = async (path: string) => files.has(path);
    fake.stat = async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return { isFile: true, isDirectory: false, size: files.get(path)!.length };
    };
    fake.exec = async () => ({ code: 127, stdout: '', stderr: 'gpg: not found' });
    return fake;
  }

  const ctxFor = (fake: FakeHost) => ({
    host: fake,
    config: defaultConfig(),
    dryRun: false,
    paths: pathsUnder('/home/tester/.gimlet'),
  });

  it('says gpg is missing rather than calling the signature invalid', async () => {
    await expect(
      gpgVerify.run(ctxFor(host()), { input: '/data/letter.txt', signature: '/data/letter.txt.sig' }),
    ).rejects.toThrow(/not installed/);
  });

  it('reports a file that is not there before it runs anything', async () => {
    await expect(gpgVerify.run(ctxFor(host()), { input: '/data/missing.txt', signature: '/data/x.sig' })).rejects.toThrow(
      /not found/,
    );
  });

  it('reads a bad signature out of the status lines', async () => {
    const fake = host();
    fake.exec = async () => ({
      code: 1,
      stdout: '[GNUPG:] NEWSIG\n[GNUPG:] BADSIG DEADBEEF12345678 Gimlet Test\n',
      stderr: '',
    });
    await expect(
      gpgVerify.run(ctxFor(fake), { input: '/data/letter.txt', signature: '/data/letter.txt.sig' }),
    ).rejects.toThrow(/does not match the file \(key DEADBEEF12345678\)/);
  });

  it('reads an unknown key out of the status lines', async () => {
    const fake = host();
    fake.exec = async () => ({
      code: 2,
      stdout: '[GNUPG:] ERRSIG 0123456789ABCDEF 22 8 01 1700000000 9 -\n[GNUPG:] NO_PUBKEY 0123456789ABCDEF\n',
      stderr: 'gpg: Can\'t check signature: No public key\n',
    });
    await expect(
      gpgVerify.run(ctxFor(fake), { input: '/data/letter.txt', signature: '/data/letter.txt.sig' }),
    ).rejects.toThrow(/signing key 0123456789ABCDEF is not in the keyring/);
  });

  it('falls back to gpg\'s own complaint when there is no status line', async () => {
    const fake = host();
    fake.exec = async () => ({ code: 2, stdout: '', stderr: 'gpg: keybox is damaged\nmore\n' });
    await expect(
      gpgVerify.run(ctxFor(fake), { input: '/data/letter.txt', signature: '/data/letter.txt.sig' }),
    ).rejects.toThrow(/keybox is damaged/);
  });
});
