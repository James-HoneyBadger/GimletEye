/**
 * Key material and the key file format.
 *
 * A key file is JSON, not PEM, and the secret half is hex: `{ "algorithm",
 * "public_key", "secret_key" }`. The format is frozen — files written by 0.5.0
 * must keep loading — so the field names and the pretty-printed shape are part
 * of the contract, not a detail of this module.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';

import { hexDecodeExact, hexEncode } from './hex.js';

export type KeyKind = 'ed25519' | 'x25519';

export const ED25519 = 'ed25519' as const;
export const X25519 = 'x25519' as const;

/** The extension the tools give a secret key, and a public one. */
export const SECRET_EXTENSION = 'key';
export const PUBLIC_EXTENSION = 'pub';

export interface KeyPair {
  kind: KeyKind;
  /** 32 raw bytes. */
  secret: Buffer;
  /** 32 raw bytes. */
  public: Buffer;
}

interface KeyFileDocument {
  algorithm: string;
  public_key: string;
  secret_key?: string;
}

export function parseKind(value: string): KeyKind {
  switch (value.trim().toLowerCase()) {
    case 'ed25519':
    case 'sign':
    case 'signing':
      return ED25519;
    case 'x25519':
    case 'encrypt':
    case 'encryption':
    case 'recipient':
      return X25519;
    default:
      throw new Error(`unknown key kind '${value}' (use ed25519 or x25519)`);
  }
}

export function generateKeyPair(kind: KeyKind): KeyPair {
  // Literal names pick Node's per-algorithm overloads; a union variable does not.
  const { privateKey, publicKey } =
    kind === ED25519 ? generateKeyPairSync('ed25519') : generateKeyPairSync('x25519');
  const secret = Buffer.from((privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).subarray(-32));
  const pub = Buffer.from((publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32));
  return { kind, secret, public: pub };
}

export function encodeSecret(pair: KeyPair): string {
  return encodeAs(pair.kind, pair.public, pair.secret);
}

export function encodePublic(pair: KeyPair): string {
  return encodeAs(pair.kind, pair.public, undefined);
}

export function decodeSecret(text: string, kind: KeyKind = ED25519): Buffer {
  const file = parseAs(text, kind);
  if (file.secret_key === undefined) {
    throw new Error('this is a public key file, not a secret key');
  }
  return hexDecodeExact(file.secret_key, 32, 'secret key');
}

export function decodePublic(text: string, kind: KeyKind = ED25519): Buffer {
  return hexDecodeExact(parseAs(text, kind).public_key, 32, 'public key');
}

/** The algorithm a key file declares, without decoding the material. */
export function algorithmOf(text: string): KeyKind {
  return parse(text).algorithm;
}

// A raw key cannot be imported by Node, so the fixed DER prefixes wrap it.
const PKCS8 = {
  ed25519: Buffer.from('302e020100300506032b657004220420', 'hex'),
  x25519: Buffer.from('302e020100300506032b656e04220420', 'hex'),
} as const;
const SPKI = {
  ed25519: Buffer.from('302a300506032b6570032100', 'hex'),
  x25519: Buffer.from('302a300506032b656e032100', 'hex'),
} as const;

export function privateKeyObject(kind: KeyKind, secret: Uint8Array) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8[kind], Buffer.from(secret)]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function publicKeyObject(kind: KeyKind, publicKey: Uint8Array) {
  return createPublicKey({
    key: Buffer.concat([SPKI[kind], Buffer.from(publicKey)]),
    format: 'der',
    type: 'spki',
  });
}

function encodeAs(kind: KeyKind, publicKey: Uint8Array, secret?: Uint8Array): string {
  const file: KeyFileDocument = { algorithm: kind, public_key: hexEncode(publicKey) };
  if (secret !== undefined) file.secret_key = hexEncode(secret);
  return JSON.stringify(file, null, 2);
}

function parse(text: string): { algorithm: KeyKind; public_key: string; secret_key?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`not a key file: ${(error as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('not a key file');
  const file = raw as Partial<KeyFileDocument>;
  const algorithm = file.algorithm;
  if (algorithm !== ED25519 && algorithm !== X25519) {
    throw new Error(`key algorithm '${String(algorithm)}' is not supported`);
  }
  if (typeof file.public_key !== 'string') throw new Error('not a key file: public_key is missing');
  if (file.secret_key !== undefined && typeof file.secret_key !== 'string') {
    throw new Error('not a key file: secret_key is not a string');
  }
  return file.secret_key === undefined
    ? { algorithm, public_key: file.public_key }
    : { algorithm, public_key: file.public_key, secret_key: file.secret_key };
}

function parseAs(text: string, kind: KeyKind): { algorithm: KeyKind; public_key: string; secret_key?: string } {
  const file = parse(text);
  if (file.algorithm !== kind) {
    throw new Error(`this is a ${file.algorithm} key file, not ${kind}`);
  }
  return file;
}
