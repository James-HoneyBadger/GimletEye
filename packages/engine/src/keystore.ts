/**
 * The sealed key store: one `.gimlet` container holding every key the user keeps.
 *
 * The file is a container whose plaintext is JSON, so the seal *is* the
 * wrapping: a wrong passphrase fails the AEAD tag before any JSON is parsed, and
 * there is one format to keep compatible rather than a second bespoke one. The
 * schema is frozen — `schema_version` is checked on the way in.
 *
 * Secrets leave this module only through the accessors a tool needs. `EntryView`
 * is what a report may contain, and it has no secret field to leak.
 */

import { chmod, mkdir, open as openFile, readFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

import { openWithPassphrase, sealWithPassphrase } from './container.js';
import { hexDecodeExact, hexEncode } from './hex.js';
import type { KeyKind, KeyPair } from './keys.js';

export const SCHEMA_VERSION = 1;
const ID_BYTES = 8;

export interface KeystoreEntry {
  id: string;
  label: string;
  kind: KeyKind;
  public_key: string;
  secret_key: string;
  created_at: string;
}

/** What a report may contain: an entry without its secret. */
export interface EntryView {
  id: string;
  label: string;
  kind: KeyKind;
  public_key: string;
  created_at: string;
}

export interface Keystore {
  schema_version: number;
  entries: KeystoreEntry[];
}

export function newId(random: () => Buffer = () => randomBytes(ID_BYTES)): string {
  return hexEncode(random());
}

export function createEntry(pair: KeyPair, label: string, createdAt: string, id = newId()): KeystoreEntry {
  return {
    id,
    label,
    kind: pair.kind,
    public_key: hexEncode(pair.public),
    secret_key: hexEncode(pair.secret),
    created_at: createdAt,
  };
}

export function viewOf(entry: KeystoreEntry): EntryView {
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    public_key: entry.public_key,
    created_at: entry.created_at,
  };
}

/** Resolve an id first, then a unique label; an ambiguous label resolves to nothing. */
export function find(store: Keystore, selector: string): KeystoreEntry {
  const byId = store.entries.find((entry) => entry.id === selector);
  if (byId !== undefined) return byId;

  const byLabel = store.entries.filter((entry) => entry.label === selector);
  if (byLabel.length === 1) return byLabel[0] as KeystoreEntry;
  if (byLabel.length === 0) throw new Error(`no key '${selector}' in the keystore`);
  throw new Error(`several keys are labelled '${selector}'; use the id instead`);
}

export function insert(store: Keystore, entry: KeystoreEntry): Keystore {
  if (store.entries.some((existing) => existing.id === entry.id)) {
    throw new Error('generated a key id that already exists');
  }
  if (store.entries.some((existing) => existing.label === entry.label)) {
    throw new Error(`a key labelled '${entry.label}' already exists (choose another label or replace it)`);
  }
  return { ...store, entries: [...store.entries, entry] };
}

export function remove(store: Keystore, selector: string): { store: Keystore; entry: KeystoreEntry } {
  const entry = find(store, selector);
  return { store: { ...store, entries: store.entries.filter((candidate) => candidate.id !== entry.id) }, entry };
}

export function secretOf(entry: KeystoreEntry): Buffer {
  if (entry.secret_key === '') {
    throw new Error(`'${entry.label}' holds only a public key`);
  }
  return hexDecodeExact(entry.secret_key, 32, 'stored secret key');
}

export function publicOf(entry: KeystoreEntry): Buffer {
  return hexDecodeExact(entry.public_key, 32, 'stored public key');
}

/** Validate a decoded document, refusing a schema this build cannot write. */
export function parseDocument(document: unknown): Keystore {
  if (typeof document !== 'object' || document === null) throw new Error('the keystore is not a JSON object');
  const candidate = document as Partial<Keystore>;
  const version = candidate.schema_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('the keystore has no usable schema_version');
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`keystore schema ${version} is newer than this build understands (${SCHEMA_VERSION})`);
  }
  if (!Array.isArray(candidate.entries)) throw new Error('the keystore has no entries array');

  const entries = candidate.entries.map((entry, index) => {
    const raw = entry as Partial<KeystoreEntry>;
    if (typeof raw.id !== 'string' || raw.id === '') throw new Error(`entry ${index} has no id`);
    if (typeof raw.label !== 'string' || raw.label === '') throw new Error(`entry ${index} has no label`);
    if (raw.kind !== 'ed25519' && raw.kind !== 'x25519') {
      throw new Error(`entry ${index} has an unknown kind '${String(raw.kind)}'`);
    }
    if (typeof raw.public_key !== 'string') throw new Error(`entry ${index} has no public_key`);
    if (typeof raw.secret_key !== 'string') throw new Error(`entry ${index} has no secret_key`);
    if (typeof raw.created_at !== 'string') throw new Error(`entry ${index} has no created_at`);
    hexDecodeExact(raw.public_key, 32, `entry ${index} public_key`);
    // An imported public half has no secret to store, and the Rust writer stored
    // an empty string for it — so empty is valid, and only a *wrong length*
    // secret is corruption.
    if (raw.secret_key !== '') hexDecodeExact(raw.secret_key, 32, `entry ${index} secret_key`);
    return {
      id: raw.id,
      label: raw.label,
      kind: raw.kind,
      public_key: raw.public_key,
      secret_key: raw.secret_key,
      created_at: raw.created_at,
    };
  });

  return { schema_version: version, entries };
}

export function encode(store: Keystore): Buffer {
  return Buffer.from(
    JSON.stringify({
      schema_version: store.schema_version,
      entries: store.entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        kind: entry.kind,
        public_key: entry.public_key,
        secret_key: entry.secret_key,
        created_at: entry.created_at,
      })),
    }),
    'utf8',
  );
}

/** Seal a store to bytes. The caller decides where they go — that is the Host's job. */
export function seal(store: Keystore, passphrase: string | Uint8Array): Buffer {
  return sealWithPassphrase(encode(store), passphrase);
}

/** Open sealed bytes. A wrong passphrase fails the tag before any JSON is parsed. */
export function open(sealed: Buffer, passphrase: string | Uint8Array): Keystore {
  const plaintext = openWithPassphrase(sealed, passphrase);
  try {
    return parseDocument(JSON.parse(plaintext.toString('utf8')));
  } catch (error) {
    throw new Error(`the keystore could not be read after opening: ${(error as Error).message}`);
  }
}

export async function load(path: string, passphrase: string | Uint8Array): Promise<Keystore> {
  let sealed: Buffer;
  try {
    sealed = await readFile(path);
  } catch {
    throw new Error(`no keystore at ${path} (create one with crypto.keygen keystore=true)`);
  }
  return open(sealed, passphrase);
}

/** Seal and write atomically, owner-only: a half-written keystore loses every key in it. */
export async function save(path: string, passphrase: string | Uint8Array, store: Keystore): Promise<void> {
  const sealed = seal(store, passphrase);
  const temp = `${path}.tmp`;
  const directory = dirname(path);
  if (directory !== '' && directory !== '.') await mkdir(directory, { recursive: true });

  const handle = await openFile(temp, 'w', 0o600);
  try {
    await handle.writeFile(sealed);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  await handle.close();

  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  await chmod(path, 0o600);
}

/** The name the tools give the store under a home directory. */
export const KEYSTORE_FILE = 'keystore.gimlet';
