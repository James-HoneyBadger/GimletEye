/**
 * The `.gimlet` container, written from `docs/CONTAINER.md`.
 *
 * This is the format's second implementation and, as of ADR 0010, the only one:
 * it reads version 1 (whole-file AEAD), version 2 (chunked), and version 3
 * (X25519 recipients), and writes 2 and 3. The committed fixtures under
 * `packages/engine/test/fixtures/` are files written by older builds, so
 * "compatible" is a test result rather than a claim.
 *
 * The cipher and KDF primitives come from `node:crypto` (OpenSSL) except
 * Argon2id, which Node does not expose; that comes from `@noble/hashes`.
 */

import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { argon2id } from '@noble/hashes/argon2.js';

import type {
  CipherChaCha20Poly1305,
  CipherGCM,
  DecipherChaCha20Poly1305,
  DecipherGCM,
} from 'node:crypto';

export const MAGIC = Buffer.from('GIML', 'ascii');
export const LEGACY_MAGIC = Buffer.from('MELV', 'ascii');

const TAG_LEN = 16;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const HEADER_LEN = 49;
const RECIPIENT_PREFIX_LEN = 44;
const RECIPIENT_ENTRY_LEN = 92;
const MAX_RECIPIENTS = 1024;
const MAX_CHUNK_CIPHERTEXT = 64 * 1024 + TAG_LEN;
const CHUNK_PLAINTEXT = 64 * 1024;
const FLAG_FINAL = 0x01;
const WRAP_INFO = Buffer.from('melv-v3-recipient', 'ascii');

/** Bytes of a version 1 or 2 header: magic through the base nonce. */
export const CONTAINER_HEADER_LEN = HEADER_LEN;

export const VERSION_WHOLE_FILE = 1;
export const VERSION_STREAMING = 2;
export const VERSION_RECIPIENT = 3;

export type CipherName = 'aes-256-gcm' | 'chacha20-poly1305';
export type CipherId = 1 | 2;
export type KdfName = 'argon2id' | 'x25519-hkdf-sha256';

export const AES_256_GCM: CipherId = 1;
export const CHACHA20_POLY1305: CipherId = 2;

export interface PassphraseHeader {
  version: typeof VERSION_WHOLE_FILE | typeof VERSION_STREAMING;
  cipher: CipherName;
  cipherId: CipherId;
  kdf: 'argon2id';
  memoryKib: number;
  timeCost: number;
  lanes: number;
  salt: Buffer;
  /** The chunk-0 base nonce, which the whole-file version uses directly. */
  nonce: Buffer;
}

export interface RecipientHeader {
  version: typeof VERSION_RECIPIENT;
  cipher: CipherName;
  cipherId: CipherId;
  kdf: 'x25519-hkdf-sha256';
  ephemeral: Buffer;
  recipients: Buffer[];
  nonce: Buffer;
  /** Fixed prefix, recipient block, and base nonce: what the chunks authenticate. */
  headerLength: number;
}

export type ContainerHeader = PassphraseHeader | RecipientHeader;

export interface SealOptions {
  cipher?: CipherId;
  /** Argon2id parameters. Defaults follow the OWASP guidance in the spec. */
  memoryKib?: number;
  timeCost?: number;
  lanes?: number;
}

export class ContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerError';
  }
}

export function inspect(blob: Buffer): ContainerHeader {
  if (blob.length < HEADER_LEN) throw new ContainerError('not a .gimlet container: too short');
  if (!hasMagic(blob)) throw new ContainerError('not a .gimlet container: bad magic');

  const version = blob[4] as number;
  const cipherId = blob[5] as number;
  const kdfId = blob[6] as number;
  if (blob[7] !== 0) {
    throw new ContainerError('reserved byte is not zero: written by a reader-unknown feature');
  }
  const cipher = cipherName(cipherId);
  const knownCipher = assertCipherId(cipherId);

  if (version === VERSION_WHOLE_FILE || version === VERSION_STREAMING) {
    if (kdfId !== 1) throw new ContainerError(`version ${version} cannot use kdf id ${kdfId}`);
    const { memoryKib, timeCost, lanes } = argon2Parameters(blob);
    return {
      version,
      cipher,
      cipherId: knownCipher,
      kdf: 'argon2id',
      memoryKib,
      timeCost,
      lanes,
      salt: Buffer.from(blob.subarray(21, 21 + SALT_LEN)),
      nonce: Buffer.from(blob.subarray(37, 37 + NONCE_LEN)),
    };
  }

  if (version === VERSION_RECIPIENT) {
    if (kdfId !== 3) throw new ContainerError(`version 3 cannot use kdf id ${kdfId}`);
    const count = blob.readUInt32LE(40);
    if (count < 1 || count > MAX_RECIPIENTS) {
      throw new ContainerError(`recipient count ${count} is outside the accepted range`);
    }
    const recipients: Buffer[] = [];
    for (let index = 0; index < count; index += 1) {
      const at = RECIPIENT_PREFIX_LEN + index * RECIPIENT_ENTRY_LEN;
      recipients.push(Buffer.from(blob.subarray(at, at + 32)));
    }
    const baseNonceAt = RECIPIENT_PREFIX_LEN + count * RECIPIENT_ENTRY_LEN;
    const headerLength = baseNonceAt + NONCE_LEN;
    if (blob.length < headerLength) {
      throw new ContainerError('container is truncated: recipient block is incomplete');
    }
    return {
      version: VERSION_RECIPIENT,
      cipher,
      cipherId: knownCipher,
      kdf: 'x25519-hkdf-sha256',
      ephemeral: Buffer.from(blob.subarray(8, 40)),
      recipients,
      nonce: Buffer.from(blob.subarray(baseNonceAt, headerLength)),
      headerLength,
    };
  }

  throw new ContainerError(`unknown container version ${version}`);
}

/** Open a version 1 or 2 container with its passphrase. */
export function openWithPassphrase(blob: Buffer, passphrase: string | Uint8Array): Buffer {
  const header = inspect(blob);
  if (header.version === VERSION_RECIPIENT) {
    throw new ContainerError('this container is for a recipient key, not a passphrase');
  }

  const key = passphraseKey(header, passphrase);
  const aad = blob.subarray(0, HEADER_LEN);
  const body = blob.subarray(HEADER_LEN);

  if (header.version === VERSION_WHOLE_FILE) {
    if (body.length < TAG_LEN) throw new ContainerError('container is truncated: no authentication tag');
    return aeadOpen(header.cipherId, key, header.nonce, body, aad);
  }
  return openChunkStream(header.cipherId, key, aad, header.nonce, body);
}

/** Bytes of a version 3 header before the recipient entries: magic through count. */
export const RECIPIENT_HEADER_PREFIX = RECIPIENT_PREFIX_LEN;

/**
 * How long a version 3 header is, from its first {@link RECIPIENT_HEADER_PREFIX}
 * bytes.
 *
 * A reader that streams has to know this before it can read the header, because
 * the count is in the header and the header is the associated data of every
 * chunk.
 */
export function recipientHeaderLength(prefix: Uint8Array): number {
  if (prefix.length < RECIPIENT_PREFIX_LEN) {
    throw new ContainerError('container is truncated: the recipient block header is incomplete');
  }
  const count = Buffer.from(prefix).readUInt32LE(40);
  if (count < 1 || count > MAX_RECIPIENTS) {
    throw new ContainerError(`recipient count ${count} is outside the accepted range`);
  }
  return RECIPIENT_PREFIX_LEN + count * RECIPIENT_ENTRY_LEN + NONCE_LEN;
}

/**
 * Unwrap the file key from a version 3 header.
 *
 * Takes only the header, so the caller can stream the chunks rather than hold
 * them: the wrapping is the header's business, the chunks are the body's.
 */
export function recipientFileKey(headerBytes: Uint8Array, secret: Uint8Array): Buffer {
  const header = inspect(Buffer.from(headerBytes));
  if (header.version !== VERSION_RECIPIENT) {
    throw new ContainerError('this container is for a passphrase, not a recipient key');
  }
  if (secret.length !== 32) throw new ContainerError('a recipient secret key is 32 bytes');

  const blob = Buffer.from(headerBytes);
  const privateKey = x25519Private(secret);
  const ourPublic = x25519PublicOf(privateKey);
  const shared = diffieHellman({ privateKey, publicKey: x25519Public(header.ephemeral) });

  for (let index = 0; index < header.recipients.length; index += 1) {
    const recipient = header.recipients[index] as Buffer;
    if (!timingSafeEqual(recipient, ourPublic)) continue;

    const at = RECIPIENT_PREFIX_LEN + index * RECIPIENT_ENTRY_LEN;
    const wrapNonce = blob.subarray(at + 32, at + 44);
    const wrapped = blob.subarray(at + 44, at + RECIPIENT_ENTRY_LEN);
    const kek = Buffer.from(
      hkdfSync('sha256', shared, header.ephemeral, Buffer.concat([WRAP_INFO, recipient]), 32),
    );
    const wrapAad = Buffer.concat([blob.subarray(0, RECIPIENT_PREFIX_LEN), recipient]);
    return aeadOpen(header.cipherId, kek, wrapNonce, wrapped, wrapAad);
  }

  throw new ContainerError('this container is not encrypted for that key');
}

/** Open a version 3 container with an X25519 secret key (32 raw bytes). */
export function openWithRecipient(blob: Buffer, secret: Uint8Array): Buffer {
  const header = inspect(blob);
  if (header.version !== VERSION_RECIPIENT) {
    throw new ContainerError('this container is for a passphrase, not a recipient key');
  }
  const headerBytes = blob.subarray(0, header.headerLength);
  return openChunkStream(
    header.cipherId,
    recipientFileKey(headerBytes, secret),
    headerBytes,
    header.nonce,
    blob.subarray(header.headerLength),
  );
}

/**
 * The parts of a version 2 container that must exist before any chunk does.
 *
 * Split out so a file can be sealed a chunk at a time: the header has to be
 * written first, and the key derived once.
 */
export interface PassphraseSetup {
  cipherId: CipherId;
  header: Buffer;
  key: Buffer;
  nonce: Buffer;
}

export function passphraseSetup(passphrase: string | Uint8Array, options: SealOptions = {}): PassphraseSetup {
  const cipherId = options.cipher ?? CHACHA20_POLY1305;
  const memoryKib = options.memoryKib ?? 19_456;
  const timeCost = options.timeCost ?? 2;
  const lanes = options.lanes ?? 1;
  assertParameters(memoryKib, timeCost, lanes);

  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const header = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(header, 0);
  header[4] = VERSION_STREAMING;
  header[5] = cipherId;
  header[6] = 1;
  header[7] = 0;
  header.writeUInt32LE(memoryKib, 8);
  header.writeUInt32LE(timeCost, 12);
  header[16] = lanes;
  salt.copy(header, 21);
  nonce.copy(header, 37);

  const key = deriveKey(
    typeof passphrase === 'string' ? Buffer.from(passphrase, 'utf8') : passphrase,
    salt,
    memoryKib,
    timeCost,
    lanes,
  );
  return { cipherId, header, key, nonce };
}

/** Seal with a passphrase. Writes version 2, the chunked layout. */
export function sealWithPassphrase(plaintext: Uint8Array, passphrase: string | Uint8Array, options: SealOptions = {}): Buffer {
  const setup = passphraseSetup(passphrase, options);
  return Buffer.concat([setup.header, sealChunkStream(setup.cipherId, setup.key, setup.header, setup.nonce, plaintext)]);
}

export interface RecipientSetup {
  cipherId: CipherId;
  header: Buffer;
  key: Buffer;
  nonce: Buffer;
}

/** Everything a version 3 container needs before its first chunk. */
export function recipientSetup(recipients: readonly Uint8Array[], options: SealOptions = {}): RecipientSetup {
  const cipherId = options.cipher ?? CHACHA20_POLY1305;
  if (recipients.length < 1 || recipients.length > MAX_RECIPIENTS) {
    throw new ContainerError(`a container needs 1 to ${MAX_RECIPIENTS} recipients`);
  }
  for (const recipient of recipients) {
    if (recipient.length !== 32) throw new ContainerError('a recipient public key is 32 bytes');
  }

  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralPublic = rawPublic(ephemeral.publicKey);
  const fileKey = randomBytes(32);
  const baseNonce = randomBytes(NONCE_LEN);

  const prefix = Buffer.alloc(RECIPIENT_PREFIX_LEN);
  MAGIC.copy(prefix, 0);
  prefix[4] = VERSION_RECIPIENT;
  prefix[5] = cipherId;
  prefix[6] = 3;
  prefix[7] = 0;
  ephemeralPublic.copy(prefix, 8);
  prefix.writeUInt32LE(recipients.length, 40);

  const entries: Buffer[] = [];
  for (const recipient of recipients) {
    const shared = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: x25519Public(recipient),
    });
    const kek = Buffer.from(
      hkdfSync('sha256', shared, ephemeralPublic, Buffer.concat([WRAP_INFO, recipient]), 32),
    );
    const wrapNonce = randomBytes(NONCE_LEN);
    const wrapAad = Buffer.concat([prefix, recipient]);
    const wrapped = aeadSeal(cipherId, kek, wrapNonce, fileKey, wrapAad);
    entries.push(Buffer.concat([Buffer.from(recipient), wrapNonce, wrapped]));
  }

  return { cipherId, header: Buffer.concat([prefix, ...entries, baseNonce]), key: fileKey, nonce: baseNonce };
}

/** Seal to one or more X25519 public keys. Writes version 3. */
export function sealForRecipients(plaintext: Uint8Array, recipients: readonly Uint8Array[], options: SealOptions = {}): Buffer {
  const setup = recipientSetup(recipients, options);
  return Buffer.concat([setup.header, sealChunkStream(setup.cipherId, setup.key, setup.header, setup.nonce, plaintext)]);
}

export function deriveKey(passphrase: Uint8Array, salt: Uint8Array, memoryKib: number, timeCost: number, lanes: number): Buffer {
  assertParameters(memoryKib, timeCost, lanes);
  return Buffer.from(
    argon2id(passphrase, salt, { t: timeCost, m: memoryKib, p: lanes, dkLen: 32 }),
  );
}

/** The chunk key for a version 1 or 2 header the caller has already parsed. */
export function passphraseKey(header: PassphraseHeader, passphrase: string | Uint8Array): Buffer {
  return deriveKey(
    typeof passphrase === 'string' ? Buffer.from(passphrase, 'utf8') : passphrase,
    header.salt,
    header.memoryKib,
    header.timeCost,
    header.lanes,
  );
}

export function generateRecipientKey(): { secret: Buffer; public: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const secret = Buffer.from(
    (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).subarray(-32),
  );
  return { secret, public: rawPublic(publicKey) };
}

/** How much plaintext one chunk carries; a reader never needs more than this. */
export const STREAM_CHUNK_PLAINTEXT = CHUNK_PLAINTEXT;

/**
 * Seal a stream one chunk at a time.
 *
 * The final flag lives in the frame, so a chunk cannot be written until the next
 * one proves it was not the last: one chunk is held back. That is the whole of
 * the buffering — 64 KiB, however large the file is.
 */
export class ChunkSealer {
  private held: Buffer | undefined;
  private index = 0;

  constructor(
    private readonly cipherId: CipherId,
    private readonly key: Buffer,
    private readonly header: Buffer,
    private readonly baseNonce: Buffer,
  ) {}

  /** Frames to write now. `plaintext` must be at most STREAM_CHUNK_PLAINTEXT. */
  push(plaintext: Uint8Array): Buffer {
    if (plaintext.length === 0) return Buffer.alloc(0);
    if (plaintext.length > CHUNK_PLAINTEXT) {
      throw new ContainerError(`a chunk of ${plaintext.length} bytes is larger than ${CHUNK_PLAINTEXT}`);
    }
    const frames: Buffer[] = [];
    if (this.held !== undefined) frames.push(this.frame(this.held, 0));
    this.held = Buffer.from(plaintext);
    return Buffer.concat(frames);
  }

  /** The last chunk, flagged final. Safe on an empty stream. */
  end(): Buffer {
    return this.frame(this.held ?? Buffer.alloc(0), FLAG_FINAL);
  }

  private frame(plaintext: Uint8Array, flags: number): Buffer {
    const sealed = aeadSeal(
      this.cipherId,
      this.key,
      chunkNonce(this.baseNonce, this.index),
      plaintext,
      chunkAad(this.header, this.index, flags),
    );
    const frame = Buffer.alloc(5);
    frame[0] = flags;
    frame.writeUInt32LE(sealed.length, 1);
    this.index += 1;
    return Buffer.concat([frame, sealed]);
  }
}

function sealChunkStream(cipherId: CipherId, key: Buffer, header: Buffer, baseNonce: Buffer, plaintext: Uint8Array): Buffer {
  const sealer = new ChunkSealer(cipherId, key, header, baseNonce);
  const frames: Buffer[] = [];
  for (let offset = 0; offset < plaintext.length; offset += CHUNK_PLAINTEXT) {
    frames.push(sealer.push(plaintext.subarray(offset, Math.min(plaintext.length, offset + CHUNK_PLAINTEXT))));
  }
  frames.push(sealer.end());
  return Buffer.concat(frames);
}

/**
 * Open a stream as its bytes arrive.
 *
 * `push` returns the plaintext of every frame that is now complete, which is at
 * most one chunk per call plus whatever the previous call left over; `end`
 * insists the stream finished the way the format says it must.
 */
export class ChunkOpener {
  private pending = Buffer.alloc(0);
  private index = 0;
  private finalSeen = false;

  constructor(
    private readonly cipherId: CipherId,
    private readonly key: Buffer,
    private readonly header: Buffer,
    private readonly baseNonce: Buffer,
  ) {}

  push(bytes: Uint8Array): Buffer {
    if (this.finalSeen) {
      if (bytes.length > 0) throw new ContainerError('trailing data after the final chunk');
      return Buffer.alloc(0);
    }
    this.pending = this.pending.length === 0 ? Buffer.from(bytes) : Buffer.concat([this.pending, bytes]);

    const out: Buffer[] = [];
    while (!this.finalSeen) {
      if (this.pending.length < 5) break;
      const flags = this.pending[0] as number;
      if ((flags & ~FLAG_FINAL) !== 0) {
        throw new ContainerError(`chunk ${this.index} has unknown flag bits 0x${flags.toString(16)}`);
      }
      const length = this.pending.readUInt32LE(1);
      if (length < TAG_LEN || length > MAX_CHUNK_CIPHERTEXT) {
        throw new ContainerError(`chunk ${this.index} declares an impossible length ${length}`);
      }
      if (this.pending.length < 5 + length) break;

      const sealed = this.pending.subarray(5, 5 + length);
      out.push(
        aeadOpen(
          this.cipherId,
          this.key,
          chunkNonce(this.baseNonce, this.index),
          sealed,
          chunkAad(this.header, this.index, flags),
        ),
      );
      this.pending = this.pending.subarray(5 + length);
      this.index += 1;
      if ((flags & FLAG_FINAL) !== 0) {
        this.finalSeen = true;
        if (this.pending.length !== 0) throw new ContainerError('trailing data after the final chunk');
      }
    }
    return Buffer.concat(out);
  }

  end(): void {
    if (!this.finalSeen) throw new ContainerError('container is truncated: the last chunk was not flagged final');
    if (this.pending.length !== 0) throw new ContainerError('trailing data after the final chunk');
  }
}

function openChunkStream(cipherId: CipherId, key: Buffer, header: Buffer, baseNonce: Buffer, body: Buffer): Buffer {
  // One implementation: the whole-buffer reader is the streaming reader fed in
  // a single call, so a bug cannot exist in one and not the other.
  const opener = new ChunkOpener(cipherId, key, header, baseNonce);
  const plaintext = opener.push(body);
  opener.end();
  return plaintext;
}

function chunkNonce(base: Buffer, index: number): Buffer {
  const nonce = Buffer.from(base);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64LE(BigInt(index));
  for (let byte = 0; byte < 8; byte += 1) {
    nonce[4 + byte] = (nonce[4 + byte] as number) ^ (counter[byte] as number);
  }
  return nonce;
}

function chunkAad(header: Buffer, index: number, flags: number): Buffer {
  const tail = Buffer.alloc(9);
  tail.writeBigUInt64LE(BigInt(index), 0);
  tail[8] = flags;
  return Buffer.concat([header, tail]);
}

function aeadSeal(cipherId: CipherId, key: Buffer, nonce: Buffer, plaintext: Uint8Array, aad: Uint8Array): Buffer {
  const cipher = sealer(cipherId, key, nonce);
  cipher.setAAD(aad, { plaintextLength: plaintext.length });
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}

function aeadOpen(cipherId: CipherId, key: Buffer, nonce: Buffer, sealed: Uint8Array, aad: Uint8Array): Buffer {
  if (sealed.length < TAG_LEN) throw new ContainerError('ciphertext is shorter than its tag');
  const body = Buffer.from(sealed.subarray(0, sealed.length - TAG_LEN));
  const tag = Buffer.from(sealed.subarray(sealed.length - TAG_LEN));
  const decipher = opener(cipherId, key, nonce);
  decipher.setAAD(aad, { plaintextLength: body.length });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // One message for a wrong passphrase and a corrupted file, on purpose: the
    // difference is an oracle.
    throw new ContainerError('decryption failed: wrong passphrase or damaged file');
  }
}

// The literal algorithm names pick Node's per-cipher overloads, which is where
// `authTagLength` is typed; a union variable falls back to a generic transform.
function sealer(id: CipherId, key: Buffer, nonce: Buffer): CipherGCM | CipherChaCha20Poly1305 {
  return id === AES_256_GCM
    ? createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN })
    : createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_LEN });
}

function opener(id: CipherId, key: Buffer, nonce: Buffer): DecipherGCM | DecipherChaCha20Poly1305 {
  return id === AES_256_GCM
    ? createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN })
    : createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_LEN });
}

function assertCipherId(id: number): CipherId {
  cipherName(id);
  return id as CipherId;
}

function cipherName(id: number): CipherName {
  switch (id) {
    case AES_256_GCM:
      return 'aes-256-gcm';
    case CHACHA20_POLY1305:
      return 'chacha20-poly1305';
    default:
      throw new ContainerError(`unknown cipher id ${id}`);
  }
}

function argon2Parameters(blob: Buffer): { memoryKib: number; timeCost: number; lanes: number } {
  const memoryKib = blob.readUInt32LE(8);
  const timeCost = blob.readUInt32LE(12);
  const lanes = blob[16] as number;
  assertParameters(memoryKib, timeCost, lanes);
  return { memoryKib, timeCost, lanes };
}

function assertParameters(memoryKib: number, timeCost: number, lanes: number): void {
  if (!Number.isInteger(memoryKib) || memoryKib < 8 || memoryKib > 1024 * 1024) {
    throw new ContainerError(`memory cost ${memoryKib} KiB is outside the accepted range`);
  }
  if (!Number.isInteger(timeCost) || timeCost < 1 || timeCost > 16) {
    throw new ContainerError(`time cost ${timeCost} is outside the accepted range`);
  }
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > 8) {
    throw new ContainerError(`lane count ${lanes} is outside the accepted range`);
  }
}

function hasMagic(blob: Buffer): boolean {
  return blob.subarray(0, 4).equals(MAGIC) || blob.subarray(0, 4).equals(LEGACY_MAGIC);
}

// Node will not import a raw X25519 key, so the fixed DER prefixes wrap it.
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

function x25519Private(secret: Uint8Array): ReturnType<typeof createPrivateKey> {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_X25519, Buffer.from(secret)]),
    format: 'der',
    type: 'pkcs8',
  });
}

function x25519Public(raw: Uint8Array): ReturnType<typeof createPublicKey> {
  return createPublicKey({
    key: Buffer.concat([SPKI_X25519, Buffer.from(raw)]),
    format: 'der',
    type: 'spki',
  });
}

function rawPublic(key: ReturnType<typeof createPublicKey>): Buffer {
  return Buffer.from((key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32));
}

function x25519PublicOf(key: ReturnType<typeof createPrivateKey>): Buffer {
  return rawPublic(createPublicKey(key));
}

/**
 * How many chunk frames the body holds, without decrypting it.
 *
 * Used by `crypto.decrypt`'s report: "chunked, 3 frames" is the evidence that a
 * large file streamed rather than being held whole.
 */
export function chunkCount(blob: Buffer): number {
  const header = inspect(blob);
  const start = header.version === VERSION_RECIPIENT ? header.headerLength : HEADER_LEN;
  if (header.version === VERSION_WHOLE_FILE) return 1;

  let offset = start;
  let count = 0;
  while (offset + 5 <= blob.length) {
    const flags = blob[offset] as number;
    const length = blob.readUInt32LE(offset + 1);
    if (length < TAG_LEN || offset + 5 + length > blob.length) break;
    count += 1;
    offset += 5 + length;
    if ((flags & FLAG_FINAL) !== 0) break;
  }
  return count;
}
