/**
 * The keystore tools: list, import, export, and rotate.
 *
 * One sealed file holds every key, so these are the operations that manage it.
 * They go through the `Host` rather than `node:fs`, which is what lets the same
 * code run in the CLI and in the desktop's main process — and what the fake-host
 * tests exercise.
 */

import {
  algorithmOf,
  createEntry,
  decodePublic,
  decodeSecret,
  encodePublic,
  encodeSecret,
  find,
  insert,
  open as openKeystore,
  parseKind,
  publicOf,
  remove,
  SCHEMA_VERSION,
  seal as sealKeystore,
  secretOf,
  viewOf,
  type Keystore,
  type KeyKind,
} from '@gimlet-eye/engine';

import { booleanOr, optString, requireString } from '../args.js';
import { invalidArgs, io, notFound } from '../errors.js';
import { stem } from '../pathutil.js';
import { keystorePath } from '../paths.js';
import { sealed, type Report } from '../report.js';
import { publishStore } from './store-file.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const PASSPHRASE_ARGS = [
  { name: 'passphrase_env', type: 'string' as const, help: 'Environment variable holding the passphrase (preferred)' },
  { name: 'passphrase', type: 'string' as const, help: 'Passphrase inline; visible in shell history' },
];

const LIST: ToolManifest = {
  id: 'crypto.key-list',
  title: 'List keys',
  summary: 'List the keys in the sealed keystore: id, label, kind, and public key',
  category: 'crypto',
  capabilities: ['fs:read', 'secrets'],
  args: [...PASSPHRASE_ARGS],
  data: {
    shape: 'object',
    required: {
    count: 'number',
    keys: 'array',
    path: 'string',
    },
  },
  tags: ['keys', 'keystore', 'inventory'],
};

const IMPORT: ToolManifest = {
  id: 'crypto.key-import',
  title: 'Import a key',
  summary: 'Add a key from a key file into the sealed keystore',
  category: 'crypto',
  capabilities: ['fs:read', 'fs:write', 'secrets'],
  args: [
    { name: 'key', type: 'path', required: true, help: 'Key file to import (<label>.key or <label>.pub)' },
    { name: 'label', type: 'string', help: "Name for the key (default: the file's stem)" },
    { name: 'kind', type: 'string', help: 'ed25519 or x25519 (default: whatever the file declares)' },
    { name: 'public_only', type: 'boolean', default: false, help: "Import only the public half, e.g. someone else's recipient key" },
    { name: 'replace', type: 'boolean', default: false, help: 'Replace an existing entry with the same label' },
    ...PASSPHRASE_ARGS,
  ],
  data: {
    shape: 'object',
    required: {
    dry_run: 'boolean',
    has_secret: 'boolean',
    id: 'string',
    keys: 'number',
    kind: 'string',
    label: 'string',
    public_key: 'string',
    },
  },
  tags: ['keys', 'keystore', 'import'],
  mutates: true,
};

const EXPORT: ToolManifest = {
  id: 'crypto.key-export',
  title: 'Export a key',
  summary: 'Write a key from the keystore to a key file; the secret needs an explicit flag',
  category: 'crypto',
  capabilities: ['fs:read', 'fs:write', 'secrets'],
  args: [
    { name: 'selector', type: 'string', required: true, help: 'Key id or label' },
    { name: 'output', type: 'path', required: true, help: 'Where to write the key file' },
    { name: 'secret', type: 'boolean', default: false, help: 'Export the secret half as well' },
    { name: 'overwrite', type: 'boolean', default: false, help: 'Replace the output file if it exists' },
    ...PASSPHRASE_ARGS,
  ],
  data: {
    shape: 'object',
    required: {
    dry_run: 'boolean',
    kind: 'string',
    label: 'string',
    output: 'string|null',
    public_key: 'string',
    secret: 'boolean',
    },
  },
  tags: ['keys', 'keystore', 'export'],
  mutates: true,
};

const ROTATE: ToolManifest = {
  id: 'crypto.key-rotate',
  title: 'Rotate the keystore passphrase',
  summary: 'Re-seal every key under a new passphrase; key material is not regenerated',
  category: 'crypto',
  capabilities: ['fs:read', 'fs:write', 'secrets'],
  args: [
    ...PASSPHRASE_ARGS,
    { name: 'new_passphrase_env', type: 'string', help: 'Environment variable holding the new passphrase (preferred)' },
    { name: 'new_passphrase', type: 'string', help: 'New passphrase inline; visible in shell history' },
  ],
  data: {
    shape: 'object',
    required: {
    dry_run: 'boolean',
    keys: 'number',
    path: 'string',
    scope: 'string',
    },
  },
  tags: ['keys', 'keystore', 'passphrase', 'rotation'],
  mutates: true,
};

export const keyList: LocalTool = {
  manifest: LIST,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const path = await keystorePath(ctx.paths, ctx.host);
    const { store } = await openStore(ctx, args);

    const keys = store.entries.map(viewOf);
    const signing = keys.filter((key) => key.kind === 'ed25519').length;
    const recipients = keys.length - signing;

    return sealed({
      tool: LIST.id,
      status: 'ok',
      summary: `${keys.length} key(s): ${signing} signing, ${recipients} recipient(s)`,
      data: { path, count: keys.length, keys },
      duration_ms: Date.now() - started,
    });
  },
};

export const keyImport: LocalTool = {
  manifest: IMPORT,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const keyPath = requireString(args, 'key');
    if (!(await ctx.host.exists(keyPath))) throw notFound(keyPath);
    const text = await ctx.host.readTextFile(keyPath);
    const declared = algorithmOf(text);
    const kind: KeyKind = optString(args, 'kind') === undefined ? declared : parseKind(requireString(args, 'kind'));
    const publicOnly = booleanOr(args, 'public_only', false);
    const replace = booleanOr(args, 'replace', false);
    const label = optString(args, 'label') ?? stem(keyPath);

    const publicKey = decodePublic(text, kind);
    const secretKey = publicOnly ? undefined : decodeSecret(text, kind);
    const entry = createEntry(
      { kind, public: publicKey, secret: secretKey ?? Buffer.alloc(0) },
      label,
      ctx.host.now().toISOString(),
    );
    if (publicOnly) entry.secret_key = '';

    const storePath = await keystorePath(ctx.paths, ctx.host);
    const pass = passphrase(args);
    // `bytes` is what the write has to still find in place: a store sealed by
    // another session in the meantime is not ours to overwrite.
    const opened = (await ctx.host.exists(storePath))
      ? await readStore(ctx, storePath, pass)
      : { store: { schema_version: SCHEMA_VERSION, entries: [] }, bytes: null };
    const base = replace && opened.store.entries.some((candidate) => candidate.label === label)
      ? remove(opened.store, label).store
      : opened.store;
    const store = insert(base, entry);
    if (!ctx.dryRun) {
      await publishStore(ctx.host, { path: storePath, bytes: opened.bytes }, sealKeystore(store, pass));
    }

    return sealed({
      tool: IMPORT.id,
      status: 'ok',
      summary: ctx.dryRun
        ? `would import '${label}' into ${storePath}`
        : `imported '${label}' (${kind}) into ${storePath}`,
      data: {
        id: entry.id,
        label,
        kind,
        public_key: entry.public_key,
        has_secret: !publicOnly,
        keys: store.entries.length,
        dry_run: ctx.dryRun,
      },
      duration_ms: Date.now() - started,
    });
  },
};

export const keyExport: LocalTool = {
  manifest: EXPORT,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const selector = requireString(args, 'selector');
    const output = requireString(args, 'output');
    const wantSecret = booleanOr(args, 'secret', false);
    const overwrite = booleanOr(args, 'overwrite', false);

    const { store } = await openStore(ctx, args, selector);
    let entry;
    try {
      entry = find(store, selector);
    } catch (error) {
      throw invalidArgs(`${(error as Error).message}${await keyFileHint(ctx, selector)}`);
    }

    const pair = wantSecret
      ? { kind: entry.kind, secret: secretOf(entry), public: publicOf(entry) }
      : { kind: entry.kind, secret: Buffer.alloc(0), public: publicOf(entry) };
    const text = wantSecret ? encodeSecret(pair) : encodePublic(pair);

    if (!ctx.dryRun) {
      if (!overwrite && (await ctx.host.exists(output))) {
        throw io(`${output} already exists (pass overwrite=true to replace it)`);
      }
      if (wantSecret) {
        // Created owner-only: a secret that exists for a moment at 0644 has
        // already been read by whatever was watching the directory.
        await ctx.host.writeFileMode(output, new TextEncoder().encode(text), 0o600);
      } else {
        await ctx.host.writeTextFile(output, text);
      }
    }

    return sealed({
      tool: EXPORT.id,
      status: 'ok',
      summary: ctx.dryRun ? `would export '${entry.label}' to ${output}` : `exported '${entry.label}' to ${output}`,
      data: {
        label: entry.label,
        kind: entry.kind,
        public_key: entry.public_key,
        output: ctx.dryRun ? null : output,
        secret: wantSecret,
        dry_run: ctx.dryRun,
      },
      duration_ms: Date.now() - started,
    });
  },
};

export const keyRotate: LocalTool = {
  manifest: ROTATE,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const storePath = await keystorePath(ctx.paths, ctx.host);
    const { store, bytes } = await openStore(ctx, args);
    const next = newPassphrase(args);

    if (!ctx.dryRun) await publishStore(ctx.host, { path: storePath, bytes }, sealKeystore(store, next));

    return sealed({
      tool: ROTATE.id,
      status: 'ok',
      summary: ctx.dryRun
        ? `would re-seal ${store.entries.length} key(s) under a new passphrase`
        : `re-sealed ${store.entries.length} key(s) under a new passphrase`,
      data: { path: storePath, keys: store.entries.length, scope: 'seal', dry_run: ctx.dryRun },
      duration_ms: Date.now() - started,
    });
  },
};

/**
 * A store that was opened, together with the bytes it was opened from.
 *
 * The bytes are not a spare copy: they are what a write compares against, so a
 * session cannot publish over a store someone else sealed in the meantime.
 */
interface Opened {
  store: Keystore;
  bytes: Buffer;
}

/**
 * Open the store, complaining about the store before the passphrase.
 *
 * Asking for a passphrase first told a user with no keystore at all that "the
 * keystore needs a passphrase", which is true and useless: there is nothing to
 * unlock.
 */
async function openStore(ctx: ToolRunContext, args: Args, selector?: string): Promise<Opened> {
  const path = await keystorePath(ctx.paths, ctx.host);
  if (!(await ctx.host.exists(path))) {
    throw notFound(`${path} (create one with crypto.keygen keystore=true)${await keyFileHint(ctx, selector)}`);
  }
  return readStore(ctx, path, passphrase(args));
}

/** A label that exists as a key file is not a key the keystore has, and saying
 * so is the difference between a puzzle and a clue. */
async function keyFileHint(ctx: ToolRunContext, selector: string | undefined): Promise<string> {
  if (selector === undefined) return '';
  const asPublic = `${selector}.pub`;
  const asSecret = `${selector}.key`;
  if ((await ctx.host.exists(asPublic)) || (await ctx.host.exists(asSecret))) {
    return ` ('${selector}' exists as a key file; this command reads the keystore)`;
  }
  return '';
}

async function readStore(ctx: ToolRunContext, path: string, pass: string): Promise<Opened> {
  if (!(await ctx.host.exists(path))) {
    throw notFound(`${path} (create one with crypto.keygen keystore=true)`);
  }
  const bytes = Buffer.from(await ctx.host.readFile(path));
  return { store: openKeystore(bytes, pass), bytes };
}

function passphrase(args: Args): string {
  return fromEnvOrArg(args, 'passphrase_env', 'passphrase', 'the keystore needs a passphrase');
}

function newPassphrase(args: Args): string {
  return fromEnvOrArg(args, 'new_passphrase_env', 'new_passphrase', 'rotation needs the new passphrase');
}

function fromEnvOrArg(args: Args, envArg: string, inlineArg: string, complaint: string): string {
  const variable = optString(args, envArg);
  if (variable !== undefined) {
    const value = process.env[variable];
    if (value === undefined || value === '') throw invalidArgs(`environment variable '${variable}' is not set or is empty`);
    return value;
  }
  const inline = optString(args, inlineArg);
  if (inline !== undefined) return inline;
  throw invalidArgs(complaint);
}

export const KEYSTORE_TOOLS: readonly LocalTool[] = [keyList, keyImport, keyExport, keyRotate];
