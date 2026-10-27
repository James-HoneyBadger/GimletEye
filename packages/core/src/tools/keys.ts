/**
 * Inspect a container, and generate keys.
 *
 * `inspect` is the tool to reach for before decrypting something a stranger
 * sent: it names the cipher and the Argon2id parameters without deriving a key.
 * `keygen` writes `<label>.key` and `<label>.pub`, or puts the pair in the
 * sealed keystore when `keystore=true`.
 */

import {
  chunkCount,
  decodePublic,
  encodePublic,
  encodeSecret,
  generateKeyPair,
  inspect,
  parseKind,
  type KeyKind,
} from '@gimlet-eye/engine';

import { booleanOr, optString, requireString, stringOr } from '../args.js';
import { io, notFound } from '../errors.js';
import { createEntry, insert, open as openKeystore, SCHEMA_VERSION, seal as sealKeystore } from '@gimlet-eye/engine';
import { sealed, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const INSPECT: ToolManifest = {
  id: 'crypto.inspect',
  title: 'Inspect a container',
  summary: 'Report the cipher, KDF parameters, and lengths of an encrypted container',
  category: 'crypto',
  capabilities: ['fs:read'],
  args: [{ name: 'input', type: 'path', required: true, help: 'Container to inspect' }],
  data: {
    shape: 'object',
    required: {
    algorithm: 'string',
    base_nonce_hex: 'string',
    chunks: 'number',
    ciphertext_bytes: 'number',
    container_bytes: 'number',
    container_version: 'number',
    kdf: 'string',
    lanes: 'number',
    max_chunk_bytes: 'number',
    memory_kib: 'number',
    path: 'string',
    streaming: 'boolean',
    time_cost: 'number',
    },
  },
  tags: ['container', 'inspection', 'metadata'],
};

const KEYGEN: ToolManifest = {
  id: 'crypto.keygen',
  title: 'Generate a key',
  summary: 'Create an Ed25519 signing key or an X25519 recipient key, in files or in the sealed keystore',
  category: 'crypto',
  capabilities: ['fs:write', 'secrets'],
  args: [
    { name: 'label', type: 'string', default: 'default', help: 'Key name; files are <label>.key and <label>.pub' },
    {
      name: 'kind',
      type: 'enum',
      values: ['ed25519', 'x25519'],
      default: 'ed25519',
      help: 'ed25519 signs, x25519 receives encrypted files',
    },
    { name: 'dir', type: 'path', default: '.', help: 'Directory to write the key files into' },
    {
      name: 'keystore',
      type: 'boolean',
      default: false,
      help: 'Store the key in the sealed keystore instead of writing files',
    },
    { name: 'overwrite', type: 'boolean', default: false, help: 'Replace existing key files' },
    {
      name: 'passphrase_env',
      type: 'string',
      help: 'Environment variable holding the keystore passphrase (preferred)',
    },
    { name: 'passphrase', type: 'string', help: 'Keystore passphrase inline' },
  ],
  data: {
    shape: 'object',
    required: {
    algorithm: 'string',
    dry_run: 'boolean',
    id: 'string',
    kind: 'string',
    label: 'string',
    public_key: 'string',
    public_path: 'null',
    secret_path: 'null',
    stored: 'string',
    },
  },
  tags: ['keys', 'ed25519', 'x25519', 'keystore'],
  mutates: true,
};

export const inspectContainer: LocalTool = {
  manifest: INSPECT,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const input = requireString(args, 'input');
    if (!(await ctx.host.exists(input))) throw notFound(input);
    const blob = Buffer.from(await ctx.host.readFile(input));

    const header = inspect(blob);
    const recipients = header.version === 3 ? header.recipients.length : 0;
    const kdfParts =
      header.kdf === 'argon2id'
        ? `argon2id · ${Math.round(header.memoryKib / 1024)} MiB · ${header.timeCost} iteration(s) · ${header.lanes} lane(s)`
        : `x25519-hkdf-sha256 · ${recipients} recipient(s)`;

    return sealed({
      tool: INSPECT.id,
      status: 'ok',
      summary: `${input} · ${header.cipher} · ${kdfParts} · ${header.version === 1 ? 'whole file' : 'chunked'}`,
      data: {
        path: input,
        container_version: header.version,
        streaming: header.version !== 1,
        max_chunk_bytes: header.version === 1 ? null : 65552,
        algorithm: header.cipher,
        kdf: header.kdf,
        ...(header.kdf === 'argon2id'
          ? { memory_kib: header.memoryKib, time_cost: header.timeCost, lanes: header.lanes }
          : { recipients }),
        base_nonce_hex: header.nonce.toString('hex'),
        chunks: chunkCount(blob),
        ciphertext_bytes: blob.length,
        container_bytes: blob.length,
      },
      duration_ms: Date.now() - started,
    });
  },
};

export const generateKey: LocalTool = {
  manifest: KEYGEN,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const label = stringOr(args, 'label', 'default');
    const kind: KeyKind = parseKind(stringOr(args, 'kind', 'ed25519'));
    const dir = stringOr(args, 'dir', '.');
    const toKeystore = booleanOr(args, 'keystore', false);
    const overwrite = booleanOr(args, 'overwrite', false);

    const pair = generateKeyPair(kind);

    if (toKeystore) {
      const path = ctx.paths.keystoreFile;
      const passphrase = keystorePassphrase(args);
      const existing = (await ctx.host.exists(path))
        ? openKeystore(Buffer.from(await ctx.host.readFile(path)), passphrase)
        : { schema_version: SCHEMA_VERSION, entries: [] };
      const store = insert(existing, createEntry(pair, label, ctx.host.now().toISOString()));
      if (!ctx.dryRun) await writeSealed(ctx, path, sealKeystore(store, passphrase));

      return sealed({
        tool: KEYGEN.id,
        status: 'ok',
        summary: ctx.dryRun ? `would add '${label}' to ${path}` : `added '${label}' to ${path}`,
        data: {
          algorithm: kind,
          kind,
          label,
          id: store.entries[store.entries.length - 1]?.id ?? null,
          public_key: encodePublic(pair),
          stored: 'keystore',
          secret_path: null,
          public_path: null,
          dry_run: ctx.dryRun,
        },
        duration_ms: Date.now() - started,
      });
    }

    const secretPath = `${dir}/${label}.key`;
    const publicPath = `${dir}/${label}.pub`;
    if (!ctx.dryRun) {
      for (const path of [secretPath, publicPath]) {
        if (!overwrite && (await ctx.host.exists(path))) {
          throw io(`${path} already exists (pass overwrite=true to replace it)`);
        }
      }
      await ctx.host.createDir(dir);
      await ctx.host.writeTextFile(secretPath, encodeSecret(pair));
      await ctx.host.writeTextFile(publicPath, encodePublic(pair));
      await ctx.host.chmodOwnerOnly(secretPath);
    }

    return sealed({
      tool: KEYGEN.id,
      status: 'ok',
      summary: ctx.dryRun ? `would write ${secretPath} and ${publicPath}` : `wrote ${secretPath} and ${publicPath}`,
      data: {
        algorithm: kind,
        kind,
        label,
        id: null,
        public_key: encodePublic(pair),
        stored: 'files',
        secret_path: ctx.dryRun ? null : secretPath,
        public_path: ctx.dryRun ? null : publicPath,
        dry_run: ctx.dryRun,
      },
      duration_ms: Date.now() - started,
    });
  },
};

/** Write through the Host: temporary file, rename, then owner-only. */
async function writeSealed(ctx: ToolRunContext, path: string, bytes: Buffer): Promise<void> {
  const temp = `${path}.tmp`;
  await ctx.host.writeFile(temp, new Uint8Array(bytes));
  await ctx.host.rename(temp, path);
  await ctx.host.chmodOwnerOnly(path);
}

/** The keystore passphrase, from the environment by preference. */
export function keystorePassphrase(args: Args): string {
  const envVar = optString(args, 'passphrase_env');
  if (envVar !== undefined) {
    const value = process.env[envVar];
    if (value === undefined || value === '') {
      throw new Error(`environment variable '${envVar}' is not set or is empty`);
    }
    return value;
  }
  const inline = optString(args, 'passphrase');
  if (inline !== undefined) return inline;
  throw new Error('the keystore needs a passphrase: pass passphrase_env (preferred) or passphrase');
}

export const INSPECT_TOOLS: readonly LocalTool[] = [inspectContainer, generateKey];

/** Re-exported for the keystore tools that follow. */
export { decodePublic };
