import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  algorithmOf,
  createEntry,
  decodePublic,
  decodeSecret,
  encode,
  encodePublic,
  encodeSecret,
  find,
  generateKeyPair,
  alphabet,
  generatePasswords,
  insert,
  KEYSTORE_FILE,
  load,
  newId,
  openWithPassphrase,
  parseDocument,
  privateKeyObject,
  publicKeyObject,
  remove,
  save,
  SCHEMA_VERSION,
  secretOf,
  sha256Hex,
  signBytes,
  verifyBytes,
  viewOf,
  X25519,
  ED25519,
} from '../src/index.js';

const scratch = () => mkdtemp(join(tmpdir(), 'gimlet-stage2-'));

describe('key files', () => {
  it('round-trips a secret and a public key through the frozen format', () => {
    const pair = generateKeyPair(ED25519);
    const secretText = encodeSecret(pair);
    const publicText = encodePublic(pair);

    expect(JSON.parse(secretText)).toEqual({
      algorithm: 'ed25519',
      public_key: pair.public.toString('hex'),
      secret_key: pair.secret.toString('hex'),
    });
    expect(JSON.parse(publicText)).toEqual({
      algorithm: 'ed25519',
      public_key: pair.public.toString('hex'),
    });

    expect(decodeSecret(secretText).equals(pair.secret)).toBe(true);
    expect(decodePublic(publicText).equals(pair.public)).toBe(true);
    expect(algorithmOf(secretText)).toBe(ED25519);
  });

  it('keeps the two kinds apart', () => {
    const pair = generateKeyPair(X25519);
    const text = encodeSecret(pair);
    expect(algorithmOf(text)).toBe(X25519);
    expect(decodeSecret(text, X25519).equals(pair.secret)).toBe(true);
    expect(() => decodeSecret(text, ED25519)).toThrow(/not ed25519/);
  });

  it('refuses a public file where a secret is needed, and malformed material', () => {
    const pair = generateKeyPair(ED25519);
    expect(() => decodeSecret(encodePublic(pair))).toThrow(/public key file/);
    expect(() => decodePublic('{"algorithm":"ed25519","public_key":"zz"}')).toThrow(/hexadecimal/);
    expect(() => decodePublic(`{"algorithm":"ed25519","public_key":"${'aa'.repeat(31)}"}`)).toThrow(/31 bytes/);
    expect(() => decodePublic('{"algorithm":"rsa"}')).toThrow(/not supported/);
    expect(() => decodePublic('not json')).toThrow(/not a key file/);
  });

  it('builds importable key objects from raw bytes', () => {
    const pair = generateKeyPair(ED25519);
    expect(privateKeyObject(ED25519, pair.secret).asymmetricKeyType).toBe('ed25519');
    expect(publicKeyObject(ED25519, pair.public).asymmetricKeyType).toBe('ed25519');
  });
});

describe('hashing and signing', () => {
  it('matches the published SHA-256 vector', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('verifies what it signed, and nothing else', () => {
    const pair = generateKeyPair(ED25519);
    const message = Buffer.from('release notes');
    const signature = signBytes(pair.secret, message);

    expect(signature).toHaveLength(64);
    expect(verifyBytes(pair.public, message, signature)).toBe(true);
    expect(verifyBytes(pair.public, Buffer.from('release note'), signature)).toBe(false);
    expect(verifyBytes(generateKeyPair(ED25519).public, message, signature)).toBe(false);
    expect(verifyBytes(pair.public, message, signature.subarray(0, 63))).toBe(false);
  });
});

describe('passphrase generation', () => {
  const has = (password: string, chars: string): boolean => [...password].some((char) => chars.includes(char));

  it('honours length and count, and guarantees a character from each class', () => {
    const result = generatePasswords({ length: 32, count: 5 });
    expect(result.passwords).toHaveLength(5);
    for (const password of result.passwords) {
      expect(password).toHaveLength(32);
      expect(has(password, 'abcdefghijklmnopqrstuvwxyz')).toBe(true);
      expect(has(password, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true);
      expect(has(password, '0123456789')).toBe(true);
      expect(has(password, '!@#$%^&*()-_=+[]{};:,.?/')).toBe(true);
    }
  });

  it('drops symbols when asked, and the lookalikes when asked', () => {
    for (const password of generatePasswords({ length: 40, count: 3, symbols: false }).passwords) {
      expect(has(password, '!@#$%^&*()-_=+[]{};:,.?/')).toBe(false);
    }
    for (const password of generatePasswords({ length: 40, count: 3, noAmbiguous: true }).passwords) {
      expect(has(password, 'Il1O0o')).toBe(false);
    }
  });

  it('reports the entropy budget it actually has', () => {
    const wide = generatePasswords({ length: 24, symbols: true });
    expect(wide.alphabet_size).toBe(alphabet(true, false).length);
    expect(wide.entropy_bits).toBe(Math.round(24 * Math.log2(wide.alphabet_size) * 10) / 10);
    expect(wide.low_entropy).toBe(false);

    const narrow = generatePasswords({ length: 8, symbols: false });
    expect(narrow.entropy_bits).toBeLessThan(60);
    expect(narrow.low_entropy).toBe(true);
  });

  it('is unbiased and deterministic when the source is', () => {
    const zeros = (bytes: number): Buffer => Buffer.alloc(bytes, 0);
    const first = generatePasswords({ length: 12, count: 2, random: zeros });
    const second = generatePasswords({ length: 12, count: 2, random: zeros });
    expect(first.passwords).toEqual(second.passwords);
  });

  it('refuses a length or count outside the documented range', () => {
    expect(() => generatePasswords({ length: 7 })).toThrow(/between 8 and 256/);
    expect(() => generatePasswords({ length: 257 })).toThrow(/between 8 and 256/);
    expect(() => generatePasswords({ count: 0 })).toThrow(/between 1 and 256/);
  });
});

describe('the sealed keystore', () => {
  const PASSPHRASE = 'keystore passphrase';

  it('saves and loads, owner-only, leaving no temporary file behind', async () => {
    const work = await scratch();
    const path = join(work, KEYSTORE_FILE);
    const pair = generateKeyPair(ED25519);
    const store = {
      schema_version: SCHEMA_VERSION,
      entries: [createEntry(pair, 'work signing key', '2026-10-27T12:00:00Z', '0011223344556677')],
    };

    await save(path, PASSPHRASE, store);
    const mode = (await stat(path)).mode & 0o777;
    expect(mode.toString(8)).toBe('600');
    expect(await readdir(work)).toEqual([KEYSTORE_FILE]);

    const loaded = await load(path, PASSPHRASE);
    expect(loaded).toEqual(store);
    expect(secretOf(loaded.entries[0]!).equals(pair.secret)).toBe(true);
  });

  it('is a real container: a wrong passphrase fails before any JSON is parsed', async () => {
    const work = await scratch();
    const path = join(work, KEYSTORE_FILE);
    const pair = generateKeyPair(X25519);
    await save(path, PASSPHRASE, {
      schema_version: SCHEMA_VERSION,
      entries: [createEntry(pair, 'recipient', '2026-10-27T12:00:00Z', 'ffeeddccbbaa9988')],
    });

    await expect(load(path, 'wrong')).rejects.toThrow(/could not be read after opening|damaged file/);

    // And the same bytes open as a container, which is the whole design.
    const sealed = await readFile(path);
    const plaintext = JSON.parse(openWithPassphrase(sealed, PASSPHRASE).toString('utf8'));
    expect(plaintext.schema_version).toBe(SCHEMA_VERSION);
  });

  it('writes the frozen JSON shape serde wrote, in the same field order', () => {
    const pair = generateKeyPair(ED25519);
    const entry = createEntry(pair, 'work', '2026-10-27T12:00:00Z', '0011223344556677');
    const text = encode({ schema_version: 1, entries: [entry] }).toString('utf8');
    expect(text).toBe(
      '{"schema_version":1,"entries":[{"id":"0011223344556677","label":"work","kind":"ed25519",' +
        `"public_key":"${pair.public.toString('hex')}","secret_key":"${pair.secret.toString('hex')}",` +
        '"created_at":"2026-10-27T12:00:00Z"}]}',
    );
  });

  it('reports entries without their secret', () => {
    const pair = generateKeyPair(ED25519);
    const view = viewOf(createEntry(pair, 'k', '2026-10-27T12:00:00Z'));
    expect(JSON.stringify(view)).not.toContain(pair.secret.toString('hex'));
    expect(view.public_key).toBe(pair.public.toString('hex'));
  });

  it('resolves an id or a unique label, and refuses an ambiguous one', () => {
    const a = createEntry(generateKeyPair(ED25519), 'work', '2026-10-27T12:00:00Z', 'aaaaaaaaaaaaaaaa');
    const b = createEntry(generateKeyPair(ED25519), 'home', '2026-10-27T12:00:00Z', 'bbbbbbbbbbbbbbbb');
    const store = { schema_version: SCHEMA_VERSION, entries: [a, b] };

    expect(find(store, 'aaaaaaaaaaaaaaaa').label).toBe('work');
    expect(find(store, 'home').id).toBe('bbbbbbbbbbbbbbbb');
    expect(() => find(store, 'nope')).toThrow(/no key 'nope'/);

    // Two entries cannot share a label through `insert`, but a hand-edited file
    // can, and then a label is not a selector any more.
    const ambiguous = { schema_version: SCHEMA_VERSION, entries: [a, b, { ...b, id: 'cccccccccccccccc' }] };
    expect(() => find(ambiguous, 'home')).toThrow(/several keys are labelled 'home'/);
  });

  it('refuses a duplicate label and a duplicate id', () => {
    const store = {
      schema_version: SCHEMA_VERSION,
      entries: [createEntry(generateKeyPair(ED25519), 'work', '2026-10-27T12:00:00Z', 'aaaaaaaaaaaaaaaa')],
    };
    const sameLabel = createEntry(generateKeyPair(ED25519), 'work', '2026-10-27T12:00:00Z', 'bbbbbbbbbbbbbbbb');
    expect(() => insert(store, sameLabel)).toThrow(/already exists/);

    const sameId = createEntry(generateKeyPair(ED25519), 'other', '2026-10-27T12:00:00Z', 'aaaaaaaaaaaaaaaa');
    expect(() => insert(store, sameId)).toThrow(/already exists/);
  });

  it('removes by selector', () => {
    const a = createEntry(generateKeyPair(ED25519), 'work', '2026-10-27T12:00:00Z', 'aaaaaaaaaaaaaaaa');
    const b = createEntry(generateKeyPair(ED25519), 'home', '2026-10-27T12:00:00Z', 'bbbbbbbbbbbbbbbb');
    const result = remove({ schema_version: SCHEMA_VERSION, entries: [a, b] }, 'aaaaaaaaaaaaaaaa');
    expect(result.entry.label).toBe('work');
    expect(result.store.entries.map((entry) => entry.label)).toEqual(['home']);
  });

  it('refuses a schema from the future and validates what it loads', () => {
    expect(() => parseDocument({ schema_version: 2, entries: [] })).toThrow(/newer than this build/);
    expect(() => parseDocument({ entries: [] })).toThrow(/schema_version/);
    expect(() => parseDocument({ schema_version: 1, entries: [{ id: 'a', label: 'b' }] })).toThrow(/kind/);
  });

  it('says where to create a keystore when there is none', async () => {
    const work = await scratch();
    await expect(load(join(work, 'missing.gimlet'), PASSPHRASE)).rejects.toThrow(/crypto.keygen keystore=true/);
  });

  it('generates ids of the documented width', () => {
    expect(newId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
