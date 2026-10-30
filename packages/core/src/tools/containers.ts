/**
 * The container pair: `crypto.encrypt` and `crypto.decrypt`.
 *
 * These are the tools where a mistake costs a file, so the defaults and the
 * refusals are the Rust ones rather than something friendlier: the output name
 * is derived from the input, an existing file is never replaced without
 * `overwrite=true`, a dry run writes nothing, and a container whose KDF
 * parameters would cost more than this tool spends unasked is refused *before*
 * deriving a key.
 */

import {
  ChunkOpener,
  ChunkSealer,
  CONTAINER_HEADER_LEN,
  inspect,
  openWithPassphrase,
  passphraseKey,
  passphraseSetup,
  RECIPIENT_HEADER_PREFIX,
  recipientFileKey,
  recipientHeaderLength,
  recipientSetup,
  STREAM_CHUNK_PLAINTEXT,
  VERSION_RECIPIENT,
  VERSION_WHOLE_FILE,
  type CipherId,
  type PassphraseSetup,
  type RecipientSetup,
} from '@gimlet-eye/engine';
import { chunkCount, sealForRecipients, sealWithPassphrase } from '@gimlet-eye/engine';
import { decodePublic, decodeSecret } from '@gimlet-eye/engine';

import { booleanOr, optString, requireString } from '../args.js';
import { refuseSamePath } from './guard.js';
import { tempName } from '../pathutil.js';
import { GimletError, invalidArgs, io, notFound } from '../errors.js';
import { sealed, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const CONTAINER_EXTENSION = 'gimlet';

/**
 * How much is read from the source at a time.
 *
 * Larger than a chunk on purpose: one open/read per chunk would mean tens of
 * thousands of system calls for a large file, and the window is still small
 * enough to keep memory flat.
 */
const READ_WINDOW = 1024 * 1024;
const LEGACY_EXTENSION = 'melv';

/** What the tool will spend on Argon2id without being told it may. */
const BUDGET_MEMORY_KIB = 256 * 1024;
const BUDGET_ITERATIONS = 6;

const PASSPHRASE_ARGS = [
  {
    name: 'passphrase_env',
    type: 'string' as const,
    help: 'Environment variable holding the passphrase (preferred: keeps it out of shell history)',
  },
  {
    name: 'passphrase',
    type: 'string' as const,
    help: 'Passphrase inline; visible to other local users and in shell history',
  },
];

const ENCRYPT: ToolManifest = {
  id: 'crypto.encrypt',
  title: 'Encrypt a file',
  summary: 'Seal a file into an authenticated container using a passphrase (Argon2id + AEAD)',
  category: 'crypto',
  capabilities: ['fs:read', 'fs:write', 'secrets'],
  args: [
    { name: 'input', type: 'path', required: true, help: 'File to encrypt' },
    { name: 'output', type: 'path', help: 'Destination path (default: <input>.gimlet)' },
    {
      name: 'to',
      type: 'string',
      help: 'Recipient public keys: comma-separated .pub files or 64-hex keys (writes a version 3 container instead of using a passphrase)',
    },
    ...PASSPHRASE_ARGS,
    { name: 'overwrite', type: 'boolean', default: false, help: 'Replace the output file if it exists' },
  ],
  data: {
    shape: 'object',
    required: {
    algorithm: 'string',
    container_bytes: 'number',
    dry_run: 'boolean',
    input: 'string',
    kdf: 'string',
    output: 'string|null',
    plaintext_bytes: 'number',
    recipients: 'number|null',
    },
  },
  tags: ['encryption', 'container', 'argon2id', 'aead'],
  mutates: true,
};

const DECRYPT: ToolManifest = {
  id: 'crypto.decrypt',
  title: 'Decrypt a file',
  summary: 'Open an authenticated container with its passphrase',
  category: 'crypto',
  capabilities: ['fs:read', 'fs:write', 'secrets'],
  args: [
    { name: 'input', type: 'path', required: true, help: 'Container to open' },
    { name: 'output', type: 'path', help: 'Destination path (default: input without the .gimlet suffix)' },
    {
      name: 'key',
      type: 'path',
      help: 'Recipient secret key file (<label>.key); required for version 3 containers',
    },
    ...PASSPHRASE_ARGS,
    { name: 'overwrite', type: 'boolean', default: false, help: 'Replace the output file if it exists' },
    {
      name: 'allow_expensive',
      type: 'boolean',
      default: false,
      help: 'Open a container whose Argon2id parameters exceed the tool budget',
    },
  ],
  data: {
    shape: 'object',
    required: {
    algorithm: 'string',
    chunks: 'number',
    container_version: 'number',
    dry_run: 'boolean',
    input: 'string',
    output: 'string|null',
    plaintext_bytes: 'number',
    },
  },
  tags: ['decryption', 'container', 'aead'],
  mutates: true,
};

export const encryptFile: LocalTool = {
  manifest: ENCRYPT,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const input = requireString(args, 'input');
    const output = optString(args, 'output') ?? `${input}.${CONTAINER_EXTENSION}`;
    const overwrite = booleanOr(args, 'overwrite', false);
    const to = optString(args, 'to');

    // Before reading: a container written over its own plaintext is a file the
    // user no longer has.
    await refuseSamePath(ctx, input, output);
    if (!(await ctx.host.exists(input))) throw notFound(input);
    const plaintextBytes = (await ctx.host.stat(input)).size;

    // The header has to exist before the first chunk, so the setup happens here
    // and the chunks are then sealed as they are read: memory stays at one
    // window plus one held-back chunk, whatever the file's size.
    let setup;
    let kdf: string;
    let recipients: number | null = null;
    if (to !== undefined) {
      const keys = await recipientKeys(ctx, to);
      setup = recipientSetup(keys);
      kdf = 'x25519-hkdf-sha256';
      recipients = keys.length;
    } else {
      setup = passphraseSetup(passphraseFrom(ctx, args));
      kdf = 'argon2id';
    }

    const containerBytes = await sealToFile(ctx, input, output, setup, overwrite, plaintextBytes);

    return sealed({
      tool: ENCRYPT.id,
      status: 'ok',
      summary: ctx.dryRun
        ? `would encrypt ${input} → ${output}`
        : `encrypted ${input} → ${output} (chacha20-poly1305, ${kdf}, ${chunksOf(plaintextBytes)} chunk(s))`,
      data: {
        input,
        output: ctx.dryRun ? null : output,
        algorithm: 'chacha20-poly1305',
        kdf,
        recipients,
        plaintext_bytes: plaintextBytes,
        container_bytes: containerBytes,
        dry_run: ctx.dryRun,
      },
      duration_ms: Date.now() - started,
    });
  },
};

export const decryptFile: LocalTool = {
  manifest: DECRYPT,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const input = requireString(args, 'input');
    const output = optString(args, 'output') ?? decryptedPath(input);
    const overwrite = booleanOr(args, 'overwrite', false);
    const keyPath = optString(args, 'key');

    // A container decrypted onto itself is gone: the plaintext replaces the only
    // copy of the key material needed to produce it.
    await refuseSamePath(ctx, input, output);
    const total = (await ctx.host.stat(input)).size;
    const headerBytes = await readHeader(ctx, input, total);
    const header = inspect(headerBytes);
    refuseExpensive(header, booleanOr(args, 'allow_expensive', false));
    let plaintextBytes = 0;

    if (header.version === VERSION_WHOLE_FILE) {
      // Version 1 authenticates the whole body in one tag, so there is nothing
      // to stream; those files predate the chunked layout and are read whole.
      const blob = await readInput(ctx, input);
      const plaintext = openWithPassphrase(blob, passphraseFrom(ctx, args));
      plaintextBytes = plaintext.length;
      await writeOutput(ctx, output, plaintext, overwrite);
    } else {
      const key =
        header.version === VERSION_RECIPIENT
          ? recipientFileKey(headerBytes, await recipientSecret(ctx, keyPath, input))
          : passphraseKey(header, passphraseFrom(ctx, args));
      plaintextBytes = await openToFile(
        ctx,
        input,
        output,
        headerBytes,
        header.cipherId,
        key,
        header.nonce,
        total,
        overwrite,
      );
    }

    return sealed({
      tool: DECRYPT.id,
      status: 'ok',
      summary: ctx.dryRun
        ? `would decrypt ${input} → ${output}`
        : `decrypted ${input} → ${output} (${header.cipher}, ${chunksOf(plaintextBytes)} chunk(s))`,
      data: {
        input,
        output: ctx.dryRun ? null : output,
        algorithm: header.cipher,
        container_version: header.version,
        chunks: chunksOf(plaintextBytes),
        plaintext_bytes: plaintextBytes,
        dry_run: ctx.dryRun,
      },
      duration_ms: Date.now() - started,
    });
  },
};

/** `<input>.gimlet`, or the name without a container suffix. */
export function decryptedPath(input: string): string {
  const match = /^(.*)\.(gimlet|melv)$/.exec(input);
  if (match !== null) return match[1] as string;
  const stem = input.replace(/\.[^./]*$/, '');
  return stem === input ? `${input}.decrypted` : `${stem}.decrypted`;
}

function refuseExpensive(header: { kdf: string; memoryKib?: number; timeCost?: number }, allow: boolean): void {
  if (allow || header.kdf !== 'argon2id') return;
  const memoryKib = header.memoryKib ?? 0;
  const timeCost = header.timeCost ?? 0;
  if (memoryKib <= BUDGET_MEMORY_KIB && timeCost <= BUDGET_ITERATIONS) return;
  throw invalidArgs(
    `this container asks for ${Math.round(memoryKib / 1024)} MiB and ${timeCost} iteration(s) of Argon2id, ` +
      `more than this tool will spend unasked (${BUDGET_MEMORY_KIB / 1024} MiB, ${BUDGET_ITERATIONS} iteration(s)). ` +
      'Pass allow_expensive=true if you trust the file, or use `crypto.inspect` to see the parameters without decrypting',
  );
}

/** The environment variable wins, so a passphrase stays out of shell history. */
function passphraseFrom(ctx: ToolRunContext, args: Args): string {
  const envVar = optString(args, 'passphrase_env');
  if (envVar !== undefined) {
    const value = process.env[envVar];
    if (value === undefined || value === '') {
      throw invalidArgs(`environment variable '${envVar}' is not set or is empty`);
    }
    return value;
  }
  const inline = optString(args, 'passphrase');
  if (inline !== undefined) return inline;
  throw invalidArgs('a passphrase is required: pass passphrase_env (preferred) or passphrase');
}

async function recipientKeys(ctx: ToolRunContext, to: string): Promise<Buffer[]> {
  const keys: Buffer[] = [];
  for (const entry of to.split(',').map((item) => item.trim()).filter((item) => item !== '')) {
    if (/^[0-9a-fA-F]{64}$/.test(entry)) {
      keys.push(decodePublic(`{"algorithm":"x25519","public_key":"${entry}"}`, 'x25519'));
      continue;
    }
    if (!(await ctx.host.exists(entry))) throw notFound(entry);
    keys.push(decodePublic(await ctx.host.readTextFile(entry), 'x25519'));
  }
  if (keys.length === 0) throw invalidArgs("'to' named no recipients");
  return keys;
}

async function recipientSecret(ctx: ToolRunContext, keyPath: string | undefined, input: string): Promise<Buffer> {
  if (keyPath === undefined) {
    throw invalidArgs(`${input} is a version 3 container: pass key=<label>.key, not a passphrase`);
  }
  if (!(await ctx.host.exists(keyPath))) throw notFound(keyPath);
  return decodeSecret(await ctx.host.readTextFile(keyPath), 'x25519');
}

async function readInput(ctx: ToolRunContext, path: string): Promise<Buffer> {
  if (!(await ctx.host.exists(path))) throw notFound(path);
  return Buffer.from(await ctx.host.readFile(path));
}

/** Chunks an empty container still has: one, holding nothing but a tag. */
function chunksOf(plaintextBytes: number): number {
  return Math.max(1, Math.ceil(plaintextBytes / STREAM_CHUNK_PLAINTEXT));
}

/** The header, read before anything else so the count is known. */
async function readHeader(ctx: ToolRunContext, input: string, total: number): Promise<Buffer> {
  if (total < CONTAINER_HEADER_LEN) throw io(`${input} is too short to be a container`);
  const first = Buffer.from(await ctx.host.readRange(input, 0, CONTAINER_HEADER_LEN));
  if ((first[4] as number) !== VERSION_RECIPIENT) return first;
  const prefix = Buffer.from(await ctx.host.readRange(input, 0, RECIPIENT_HEADER_PREFIX));
  const length = recipientHeaderLength(prefix);
  if (total < length) throw io(`${input} is truncated: the recipient block is incomplete`);
  return Buffer.from(await ctx.host.readRange(input, 0, length));
}

/**
 * Seal `input` into `output` a chunk at a time.
 *
 * The destination is written through a sibling temporary file, so an interrupted
 * run leaves the old file rather than half of a new one, and an existing file
 * keeps its permission bits.
 */
async function sealToFile(
  ctx: ToolRunContext,
  input: string,
  output: string,
  setup: PassphraseSetup | RecipientSetup,
  overwrite: boolean,
  size: number,
): Promise<number> {
  if (ctx.dryRun) return 0;
  if (!overwrite && (await ctx.host.exists(output))) {
    throw io(`${output} already exists (pass overwrite=true to replace it)`);
  }
  const temp = tempName(output);
  try {
    const keep = await ctx.host.mode(output);
    await ctx.host.appendFile(temp, new Uint8Array(setup.header));
    const sealer = new ChunkSealer(setup.cipherId, setup.key, setup.header, setup.nonce);
    for (let offset = 0; offset < size; offset += READ_WINDOW) {
      const window = await ctx.host.readRange(input, offset, Math.min(READ_WINDOW, size - offset));
      if (window.length === 0) break;
      for (let at = 0; at < window.length; at += STREAM_CHUNK_PLAINTEXT) {
        const frame = sealer.push(window.subarray(at, Math.min(window.length, at + STREAM_CHUNK_PLAINTEXT)));
        if (frame.length > 0) await ctx.host.appendFile(temp, frame);
      }
    }
    await ctx.host.appendFile(temp, sealer.end());
    if (keep !== undefined) await ctx.host.chmod(temp, keep);
    await ctx.host.rename(temp, output);
  } catch (error) {
    await ctx.host.removeTree(temp).catch(() => undefined);
    throw error instanceof GimletError ? error : io(`${output}: ${(error as Error).message}`);
  }
  return (await ctx.host.stat(output)).size;
}

/** Open `input` into `output` a chunk at a time, for versions 2 and 3. */
async function openToFile(
  ctx: ToolRunContext,
  input: string,
  output: string,
  headerBytes: Buffer,
  cipherId: CipherId,
  key: Buffer,
  nonce: Buffer,
  total: number,
  overwrite: boolean,
): Promise<number> {
  if (ctx.dryRun) return 0;
  if (!overwrite && (await ctx.host.exists(output))) {
    throw io(`${output} already exists (pass overwrite=true to replace it)`);
  }
  const temp = tempName(output);
  try {
    // Decrypted plaintext is created owner-only, and keeps the destination's
    // mode when the destination already existed.
    const keep = await ctx.host.mode(output);
    await ctx.host.writeFileMode(temp, new Uint8Array(0), keep ?? 0o600);
    const opener = new ChunkOpener(cipherId, key, headerBytes, nonce);
    let written = 0;
    for (let offset = headerBytes.length; offset < total; offset += READ_WINDOW) {
      const window = await ctx.host.readRange(input, offset, Math.min(READ_WINDOW, total - offset));
      if (window.length === 0) break;
      const plaintext = opener.push(window);
      if (plaintext.length > 0) {
        await ctx.host.appendFile(temp, plaintext);
        written += plaintext.length;
      }
    }
    opener.end();
    await ctx.host.rename(temp, output);
    return written;
  } catch (error) {
    await ctx.host.removeTree(temp).catch(() => undefined);
    throw error instanceof GimletError ? error : io(`${output}: ${(error as Error).message}`);
  }
}

async function writeOutput(ctx: ToolRunContext, path: string, bytes: Buffer, overwrite: boolean): Promise<void> {
  if (ctx.dryRun) return;
  if (!overwrite && (await ctx.host.exists(path))) {
    throw io(`${path} already exists (pass overwrite=true to replace it)`);
  }
  // A version 1 container is read whole, but the plaintext still lands through a
  // temp and a rename: an interrupted write must not leave half a file where the
  // user expects a whole one.
  const temp = tempName(path);
  try {
    const keep = await ctx.host.mode(path);
    await ctx.host.writeFileMode(temp, new Uint8Array(bytes), keep ?? 0o600);
    await ctx.host.rename(temp, path);
  } catch (error) {
    await ctx.host.removeTree(temp).catch(() => undefined);
    throw error instanceof GimletError ? error : io(`${path}: ${(error as Error).message}`);
  }
}

export const CONTAINER_TOOLS: readonly LocalTool[] = [encryptFile, decryptFile];
