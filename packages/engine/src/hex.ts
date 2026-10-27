/** Hex, strictly. A key that is not 32 bytes is a mistake, not a variant. */

export function hexEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function hexDecode(text: string): Buffer {
  const trimmed = text.trim();
  if (trimmed.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(trimmed)) {
    throw new Error('not hexadecimal');
  }
  return Buffer.from(trimmed, 'hex');
}

/** Decode a key or id of an exact byte length, naming what was wrong. */
export function hexDecodeExact(text: string, bytes: number, what: string): Buffer {
  const decoded = hexDecode(text);
  if (decoded.length !== bytes) {
    throw new Error(`${what} is ${decoded.length} bytes, expected ${bytes}`);
  }
  return decoded;
}
