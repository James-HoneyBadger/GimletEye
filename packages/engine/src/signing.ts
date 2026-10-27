/**
 * Signing and hashing.
 *
 * Ed25519 over the whole file, with the digest reported alongside so a person
 * can compare a fingerprint out of band. Verification returns a boolean rather
 * than throwing: a bad signature is an answer, not an error.
 */

import { createHash, sign as edSign, verify as edVerify } from 'node:crypto';

import { ED25519, privateKeyObject, publicKeyObject } from './keys.js';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function signBytes(secret: Uint8Array, data: Uint8Array): Buffer {
  return edSign(null, data, privateKeyObject(ED25519, secret));
}

export function verifyBytes(publicKey: Uint8Array, data: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  try {
    return edVerify(null, data, publicKeyObject(ED25519, publicKey), signature);
  } catch {
    // A point that is not on the curve is a failed verification, not a crash.
    return false;
  }
}
