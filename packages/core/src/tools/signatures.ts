/**
 * Detached Ed25519 signatures.
 *
 * The signature is the hex of the 64-byte signature, so `--format json` and the
 * `.sig` file carry the same bytes. Verification treats a bad signature as an
 * answer rather than an exception: the report says `valid: false` and the verdict
 * is an error, which is what `--strict` gates on.
 */

import { decodePublic, decodeSecret, encodeSecret, signBytes, verifyBytes } from '@gimlet-eye/engine';

import { booleanOr, optString, requireString } from '../args.js';
import { invalidArgs, io, notFound } from '../errors.js';
import { sealed, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const SIGN: ToolManifest = {
  id: 'crypto.sign',
  title: 'Sign a file',
  summary: 'Produce a detached Ed25519 signature for a file',
  category: 'crypto',
  capabilities: ['fs:read', 'fs:write', 'secrets'],
  args: [
    { name: 'input', type: 'path', required: true, help: 'File to sign' },
    { name: 'key', type: 'path', required: true, help: 'Secret key file (<label>.key)' },
    { name: 'output', type: 'path', help: 'Signature path (default: <input>.sig)' },
    { name: 'overwrite', type: 'boolean', default: false, help: 'Replace the signature file if it exists' },
  ],
  tags: ['signature', 'ed25519', 'integrity'],
  mutates: true,
};

const VERIFY: ToolManifest = {
  id: 'crypto.verify',
  title: 'Verify a signature',
  summary: 'Check a detached Ed25519 signature against a public key',
  category: 'crypto',
  capabilities: ['fs:read'],
  args: [
    { name: 'input', type: 'path', required: true, help: 'File that was signed' },
    { name: 'signature', type: 'path', required: true, help: 'Detached signature file' },
    { name: 'key', type: 'path', required: true, help: 'Public key file (<label>.pub)' },
  ],
  tags: ['signature', 'ed25519', 'verification'],
};

export const signFile: LocalTool = {
  manifest: SIGN,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const input = requireString(args, 'input');
    const keyPath = requireString(args, 'key');
    const output = optString(args, 'output') ?? `${input}.sig`;
    const overwrite = booleanOr(args, 'overwrite', false);

    const data = await readRequired(ctx, input, 'input');
    const secret = decodeSecret(await readText(ctx, keyPath), 'ed25519');
    const signature = signBytes(secret, data);

    if (!ctx.dryRun) {
      if (!overwrite && (await ctx.host.exists(output))) {
        throw io(`${output} already exists (pass overwrite=true to replace it)`);
      }
      await ctx.host.writeTextFile(output, signature.toString('hex'));
    }

    return sealed({
      tool: SIGN.id,
      status: 'ok',
      summary: ctx.dryRun ? `would sign ${input}` : `signed ${input}`,
      data: {
        input,
        signature: ctx.dryRun ? null : output,
        algorithm: 'ed25519',
        signature_hex: signature.toString('hex'),
        dry_run: ctx.dryRun,
      },
      duration_ms: Date.now() - started,
    });
  },
};

export const verifyFile: LocalTool = {
  manifest: VERIFY,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const input = requireString(args, 'input');
    const signaturePath = requireString(args, 'signature');
    const keyPath = requireString(args, 'key');

    const data = await readRequired(ctx, input, 'input');
    const publicKey = decodePublic(await readText(ctx, keyPath), 'ed25519');
    const hex = (await readText(ctx, signaturePath)).trim();
    if (!/^[0-9a-fA-F]{128}$/.test(hex)) {
      throw invalidArgs(`${signaturePath} does not contain a 64-byte signature`);
    }
    const signature = Buffer.from(hex, 'hex');

    const valid = verifyBytes(publicKey, data, signature);

    return sealed({
      tool: VERIFY.id,
      status: 'ok',
      summary: valid ? `${input}: signature is valid` : `${input}: signature does NOT match`,
      findings: valid
        ? []
        : [
            {
              severity: 'high',
              code: 'crypto.signature_invalid',
              message: `${signaturePath} does not verify against ${keyPath} for ${input}`,
            },
          ],
      data: {
        input,
        signature: signaturePath,
        key: keyPath,
        public_key: publicKey.toString('hex'),
        algorithm: 'ed25519',
        valid,
      },
      duration_ms: Date.now() - started,
    });
  },
};

async function readRequired(ctx: ToolRunContext, path: string, arg: string): Promise<Buffer> {
  if (!(await ctx.host.exists(path))) throw notFound(`${path} (${arg})`);
  return Buffer.from(await ctx.host.readFile(path));
}

async function readText(ctx: ToolRunContext, path: string): Promise<string> {
  if (!(await ctx.host.exists(path))) throw notFound(path);
  return ctx.host.readTextFile(path);
}

export const SIGNING_TOOLS: readonly LocalTool[] = [signFile, verifyFile];

/** Re-exported so a caller writing a key file does not have to find it twice. */
export { encodeSecret };
