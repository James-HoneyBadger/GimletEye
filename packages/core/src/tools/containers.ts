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

import { chunkCount, inspect, openWithPassphrase, openWithRecipient, sealForRecipients, sealWithPassphrase } from '@gimlet-eye/engine';
import { decodePublic, decodeSecret } from '@gimlet-eye/engine';

import { booleanOr, optString, requireString } from '../args.js';
import { invalidArgs, io, notFound } from '../errors.js';
import { sealed, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const CONTAINER_EXTENSION = 'gimlet';
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

    const plaintext = await readInput(ctx, input);
    let sealedBytes: Buffer;
    let kdf: string;
    let recipients: number | null = null;

    if (to !== undefined) {
      const keys = await recipientKeys(ctx, to);
      sealedBytes = sealForRecipients(plaintext, keys);
      kdf = 'x25519-hkdf-sha256';
      recipients = keys.length;
    } else {
      sealedBytes = sealWithPassphrase(plaintext, passphraseFrom(ctx, args));
      kdf = 'argon2id';
    }

    await writeOutput(ctx, output, sealedBytes, overwrite);

    return sealed({
      tool: ENCRYPT.id,
      status: 'ok',
      summary: ctx.dryRun
        ? `would encrypt ${input} → ${output}`
        : `encrypted ${input} → ${output} (chacha20-poly1305, ${kdf}, ${chunkCount(sealedBytes)} chunk(s))`,
      data: {
        input,
        output: ctx.dryRun ? null : output,
        algorithm: 'chacha20-poly1305',
        kdf,
        recipients,
        plaintext_bytes: plaintext.length,
        container_bytes: sealedBytes.length,
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

    const blob = await readInput(ctx, input);
    const header = inspect(blob);
    refuseExpensive(header, booleanOr(args, 'allow_expensive', false));

    const plaintext =
      header.version === 3
        ? openWithRecipient(blob, await recipientSecret(ctx, keyPath, input))
        : openWithPassphrase(blob, passphraseFrom(ctx, args));

    await writeOutput(ctx, output, plaintext, overwrite);

    return sealed({
      tool: DECRYPT.id,
      status: 'ok',
      summary: ctx.dryRun
        ? `would decrypt ${input} → ${output}`
        : `decrypted ${input} → ${output} (${header.cipher}, ${chunkCount(blob)} chunk(s))`,
      data: {
        input,
        output: ctx.dryRun ? null : output,
        algorithm: header.cipher,
        container_version: header.version,
        chunks: chunkCount(blob),
        plaintext_bytes: plaintext.length,
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

async function writeOutput(ctx: ToolRunContext, path: string, bytes: Buffer, overwrite: boolean): Promise<void> {
  if (ctx.dryRun) return;
  if (!overwrite && (await ctx.host.exists(path))) {
    throw io(`${path} already exists (pass overwrite=true to replace it)`);
  }
  await ctx.host.writeFile(path, new Uint8Array(bytes));
}

export const CONTAINER_TOOLS: readonly LocalTool[] = [encryptFile, decryptFile];
