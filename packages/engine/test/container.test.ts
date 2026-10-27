import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ContainerError,
  generateRecipientKey,
  inspect,
  openWithPassphrase,
  openWithRecipient,
  sealForRecipients,
  sealWithPassphrase,
  VERSION_RECIPIENT,
  VERSION_STREAMING,
  VERSION_WHOLE_FILE,
} from '../src/container.js';

/** Files written by older builds, carried over unchanged: compatibility is a test result. */
const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const V1_PASSPHRASE = 'correct horse battery staple';
const V1_PLAINTEXT = 'a container written by 0.2.0: whole-file AEAD, version 1\n';
/** A test key, fixed so the fixture opens forever. It protects nothing. */
const V3_SECRET = Buffer.alloc(32, 3);
const V3_PLAINTEXT = 'a container written by 0.5.0: x25519 recipient, version 3\n';

/** Smallest parameters the format allows, so the suite stays quick. */
const FAST = { memoryKib: 64, timeCost: 1, lanes: 1 };

describe('files written by older builds', () => {
  it('opens a version 1 container from 0.2.0', () => {
    const blob = fixture('container-v1.melv');
    expect(inspect(blob).version).toBe(VERSION_WHOLE_FILE);
    expect(openWithPassphrase(blob, V1_PASSPHRASE).toString('utf8')).toBe(V1_PLAINTEXT);
  });

  it('is not the version the current writer emits', () => {
    // Otherwise the compatibility test would be a tautology.
    expect(fixture('container-v1.melv')[4]).toBe(VERSION_WHOLE_FILE);
    expect(fixture('container-v1.melv')[4]).not.toBe(VERSION_STREAMING);
  });

  it('opens a version 3 container addressed to a key', () => {
    const blob = fixture('container-v3.melv');
    const header = inspect(blob);
    expect(header.version).toBe(VERSION_RECIPIENT);
    expect(header.recipients).toHaveLength(1);
    expect(openWithRecipient(blob, V3_SECRET).toString('utf8')).toBe(V3_PLAINTEXT);
  });

  it('says a v3 container is not for this key rather than failing obscurely', () => {
    const stranger = generateRecipientKey().secret;
    expect(() => openWithRecipient(fixture('container-v3.melv'), stranger)).toThrow(/not encrypted for that key/);
  });

  it('refuses a passphrase for a container that wants a key, and the reverse', () => {
    expect(() => openWithPassphrase(fixture('container-v3.melv'), 'x')).toThrow(/recipient key/);
    expect(() => openWithRecipient(fixture('container-v1.melv'), V3_SECRET)).toThrow(/passphrase/);
  });
});

describe('passphrase containers', () => {
  it('round-trips, including the empty file and a multi-chunk stream', () => {
    for (const size of [0, 1, 64 * 1024 - 1, 64 * 1024, 64 * 1024 + 1, 200 * 1024]) {
      const plaintext = Buffer.alloc(size, 0x5a);
      const sealed = sealWithPassphrase(plaintext, 'pw', FAST);
      expect(inspect(sealed).version).toBe(VERSION_STREAMING);
      expect(openWithPassphrase(sealed, 'pw').equals(plaintext)).toBe(true);
    }
  });

  it('authenticates the header, so a weaker parameter cannot be substituted', () => {
    const sealed = sealWithPassphrase(Buffer.from('hello'), 'pw', FAST);
    const tampered = Buffer.from(sealed);
    tampered.writeUInt32LE(8, 8); // claim the minimum memory cost
    expect(() => openWithPassphrase(tampered, 'pw')).toThrow(ContainerError);
  });

  it('rejects a wrong passphrase and a damaged body with one message', () => {
    const sealed = sealWithPassphrase(Buffer.from('hello world'), 'pw', FAST);
    expect(() => openWithPassphrase(sealed, 'nope')).toThrow(/wrong passphrase or damaged file/);
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] as number) ^ 0x01;
    expect(() => openWithPassphrase(flipped, 'pw')).toThrow(/wrong passphrase or damaged file/);
  });

  it('refuses a truncated stream, a stream that just stops, and trailing data', () => {
    const sealed = sealWithPassphrase(Buffer.alloc(100 * 1024, 1), 'pw', FAST);
    expect(() => openWithPassphrase(sealed.subarray(0, sealed.length - 20), 'pw')).toThrow(/truncated/);

    // A stream cut exactly at a chunk boundary: nothing was garbled, the final
    // chunk is simply absent.
    const chunk0End = 49 + 5 + (64 * 1024 + 16);
    expect(() => openWithPassphrase(sealed.subarray(0, chunk0End), 'pw')).toThrow(/not flagged final/);

    // The flags byte is inside the associated data, so editing it fails the tag
    // rather than reaching the framing check.
    const oneChunk = sealWithPassphrase(Buffer.from('small'), 'pw', FAST);
    const unflagged = Buffer.from(oneChunk);
    unflagged[49] = 0;
    expect(() => openWithPassphrase(unflagged, 'pw')).toThrow(/wrong passphrase or damaged file/);

    const trailing = Buffer.concat([sealed, Buffer.from([0])]);
    expect(() => openWithPassphrase(trailing, 'pw')).toThrow(/trailing data/);
  });

  it('refuses a chunk length outside the frame it can possibly hold', () => {
    const sealed = sealWithPassphrase(Buffer.from('hello'), 'pw', FAST);
    const absurd = Buffer.from(sealed);
    absurd.writeUInt32LE(0xffff_ffff, 50);
    expect(() => openWithPassphrase(absurd, 'pw')).toThrow(/impossible length/);
  });

  it('refuses a crafted header that asks for gigabytes before deriving a key', () => {
    const sealed = sealWithPassphrase(Buffer.from('hello'), 'pw', FAST);
    const greedy = Buffer.from(sealed);
    greedy.writeUInt32LE(2 * 1024 * 1024, 8);
    const started = Date.now();
    expect(() => openWithPassphrase(greedy, 'pw')).toThrow(/outside the accepted range/);
    expect(Date.now() - started).toBeLessThan(250);
  });

  it('refuses a non-zero reserved byte instead of ignoring it', () => {
    const sealed = sealWithPassphrase(Buffer.from('hello'), 'pw', FAST);
    const future = Buffer.from(sealed);
    future[7] = 1;
    expect(() => openWithPassphrase(future, 'pw')).toThrow(/reserved byte/);
  });
});

describe('recipient containers', () => {
  it('wraps one file key for every recipient', () => {
    const alice = generateRecipientKey();
    const bob = generateRecipientKey();
    const plaintext = Buffer.from('for two people\n');

    const sealed = sealForRecipients(plaintext, [alice.public, bob.public]);
    expect(inspect(sealed).recipients).toHaveLength(2);
    expect(openWithRecipient(sealed, alice.secret).toString('utf8')).toBe('for two people\n');
    expect(openWithRecipient(sealed, bob.secret).toString('utf8')).toBe('for two people\n');
  });

  it('does not open for a key that was not listed', () => {
    const alice = generateRecipientKey();
    const stranger = generateRecipientKey();
    const sealed = sealForRecipients(Buffer.from('x'), [alice.public]);
    expect(() => openWithRecipient(sealed, stranger.secret)).toThrow(/not encrypted for that key/);
  });

  it('binds each wrapped key to its recipient entry', () => {
    const alice = generateRecipientKey();
    const bob = generateRecipientKey();
    const sealed = sealForRecipients(Buffer.from('x'), [alice.public, bob.public]);
    // Swap two recipient blocks: the associated data no longer matches.
    const swapped = Buffer.from(sealed);
    const first = Buffer.from(swapped.subarray(44, 44 + 92));
    Buffer.from(swapped.subarray(44 + 92, 44 + 184)).copy(swapped, 44);
    first.copy(swapped, 44 + 92);
    expect(() => openWithRecipient(swapped, alice.secret)).toThrow(ContainerError);
  });

  it('streams a multi-chunk payload under the file key', () => {
    const alice = generateRecipientKey();
    const plaintext = Buffer.alloc(150 * 1024, 7);
    const sealed = sealForRecipients(plaintext, [alice.public]);
    expect(openWithRecipient(sealed, alice.secret).equals(plaintext)).toBe(true);
  });
});

describe('the second implementation', () => {
  it('reads a container this writer produced', () => {
    let available = true;
    try {
      execFileSync('python3', ['-c', 'import cryptography.hazmat.primitives.kdf.argon2'], { stdio: 'ignore' });
    } catch {
      try {
        execFileSync('python3', ['-c', 'import argon2'], { stdio: 'ignore' });
      } catch {
        available = false;
      }
    }
    if (!available) {
      // CI installs these; a bare checkout may not have them.
      expect(process.env['GIMLET_REQUIRE_SECOND_IMPL']).toBeUndefined();
      return;
    }

    const work = mkdtempSync(join(tmpdir(), 'gimlet-engine-'));
    const file = join(work, 'multi.gimlet');
    const plaintext = Buffer.from('read by the python implementation\n'.repeat(4000));
    writeFileSync(file, sealWithPassphrase(plaintext, 'second-impl', FAST));

    const output = execFileSync(
      'python3',
      [new URL('./fixtures/read_container.py', import.meta.url).pathname, file, '--passphrase', 'second-impl'],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    expect(output.equals(plaintext)).toBe(true);
  });
});
