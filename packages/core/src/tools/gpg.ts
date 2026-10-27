/**
 * OpenPGP interop: `crypto.gpg-verify` and `crypto.gpg-encrypt`.
 *
 * These drive the system `gpg` rather than implementing OpenPGP, which is the
 * decision recorded in ADR 0007: a second implementation would be months of
 * work and a large new parser to fuzz, and the point is that a user who already
 * has GPG keys can use them.
 *
 * Every invocation passes paths as separate arguments (never through a shell),
 * runs `--batch` with no TTY, and turns gpg's own `[GNUPG:]` status lines into
 * data. A missing `gpg` is an error that says so, not a silent "invalid
 * signature" — those are different problems and only the status lines tell them
 * apart.
 */

import { booleanOr, optString, requireString } from '../args.js';
import { invalidArgs, io, notFound, toolFailed } from '../errors.js';
import { sealed, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const PROGRAM = 'gpg';

const HOMEDIR_ARG = {
  name: 'homedir',
  type: 'path' as const,
  help: "GnuPG home directory (default: gpg's own)",
};

const VERIFY: ToolManifest = {
  id: 'crypto.gpg-verify',
  title: 'Verify a GnuPG signature',
  summary: 'Check a detached signature with the system gpg and its keyring',
  category: 'crypto',
  capabilities: ['fs:read', 'process:exec'],
  args: [
    { name: 'input', type: 'path', required: true, help: 'Signed file' },
    { name: 'signature', type: 'path', required: true, help: 'Detached signature to check' },
    HOMEDIR_ARG,
  ],
  data: {
    shape: 'object',
    required: {
    backend: 'string',
    fingerprint: 'string',
    input: 'string',
    signature: 'string',
    signer: 'string',
    valid: 'boolean',
    },
  },
  tags: ['gpg', 'openpgp', 'signature', 'interop'],
};

const ENCRYPT: ToolManifest = {
  id: 'crypto.gpg-encrypt',
  title: 'Encrypt for a GnuPG recipient',
  summary: 'Produce an OpenPGP message with the system gpg, for people who already have GPG keys',
  category: 'crypto',
  capabilities: ['fs:read', 'fs:write', 'process:exec'],
  args: [
    { name: 'input', type: 'path', required: true, help: 'File to encrypt' },
    {
      name: 'recipient',
      type: 'string',
      required: true,
      help: 'Recipient key id, fingerprint, or email as gpg knows it',
    },
    { name: 'output', type: 'path', help: 'Destination (default: <input>.gpg)' },
    HOMEDIR_ARG,
    { name: 'overwrite', type: 'boolean', default: false, help: 'Replace the output file if it exists' },
  ],
  data: {
    shape: 'object',
    required: {
    backend: 'string',
    dry_run: 'boolean',
    input: 'string',
    output: 'string|null',
    output_bytes: 'number',
    recipient: 'string',
    },
  },
  tags: ['gpg', 'openpgp', 'encryption', 'interop'],
  mutates: true,
};

/** What one `gpg` run produced. Kept as data, not an error, because only the
 * status lines explain *why* `--verify` failed: a bad signature and a missing
 * key both exit non-zero and they are not the same problem. */
interface GpgRun {
  success: boolean;
  status: string;
  stderr: string;
}

async function runGpg(ctx: ToolRunContext, homedir: string | undefined, args: readonly string[]): Promise<GpgRun> {
  const withHome = homedir === undefined ? args : ['--homedir', homedir, ...args];
  const result = await ctx.host.exec(PROGRAM, withHome);
  if (result.code === 127) {
    throw notFound(`'${PROGRAM}' is not installed; OpenPGP interop needs it on PATH`);
  }
  if (result.code === 126) {
    throw toolFailed(`${PROGRAM} could not be started: ${result.stderr.trim()}`);
  }
  return { success: result.code === 0, status: result.stdout, stderr: result.stderr };
}

/** The whole `[GNUPG:] <keyword> ...` line, without its prefix. */
function statusLine(status: string, keyword: string): string | undefined {
  for (const line of status.split('\n')) {
    const body = line.startsWith('[GNUPG:] ') ? line.slice('[GNUPG:] '.length) : undefined;
    if (body !== undefined && body.startsWith(keyword)) return body;
  }
  return undefined;
}

/** Whitespace-separated field `n`, counting the keyword as 0. */
function statusField(status: string, keyword: string, n: number): string | undefined {
  const line = statusLine(status, keyword);
  if (line === undefined) return undefined;
  return line.split(/\s+/).filter((part) => part !== '')[n];
}

/**
 * Everything after the key id, spaces included.
 *
 * Rust's `splitn(3, ' ')` keeps the remainder whole; JavaScript's
 * `split(' ', 3)` would cut a signer's name at its first space.
 */
function statusAfterId(status: string, keyword: string): string | undefined {
  const line = statusLine(status, keyword);
  if (line === undefined) return undefined;
  const first = line.indexOf(' ');
  if (first < 0) return undefined;
  const second = line.indexOf(' ', first + 1);
  if (second < 0) return undefined;
  return line.slice(second + 1);
}

/** The first meaningful line of gpg's own diagnosis, cleaned for a report. */
function complaint(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((part) => part.trim().replace(/^gpg: /, ''))
    .find((part) => part !== '');
  return line ?? 'gpg reported a failure';
}

async function requireFile(ctx: ToolRunContext, path: string): Promise<void> {
  if (!(await ctx.host.exists(path))) throw notFound(path);
  const info = await ctx.host.stat(path);
  if (!info.isFile) throw notFound(path);
}

export const gpgVerify: LocalTool = {
  manifest: VERIFY,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const input = requireString(args, 'input');
    const signature = requireString(args, 'signature');
    await requireFile(ctx, input);
    await requireFile(ctx, signature);

    const run = await runGpg(ctx, optString(args, 'homedir'), [
      '--batch',
      '--no-tty',
      '--status-fd',
      '1',
      '--verify',
      signature,
      input,
    ]);

    // VALIDSIG carries the fingerprint; GOODSIG/BADSIG/ERRSIG carry the key id.
    const fingerprint = statusField(run.status, 'VALIDSIG', 1);
    if (fingerprint === undefined) {
      const bad = statusField(run.status, 'BADSIG', 1);
      if (bad !== undefined) throw toolFailed(`signature does not match the file (key ${bad})`);
      const unknown = statusField(run.status, 'ERRSIG', 1);
      if (unknown !== undefined) throw toolFailed(`signing key ${unknown} is not in the keyring`);
      if (!run.success) throw toolFailed(complaint(run.stderr));
      throw toolFailed('gpg did not report a valid signature');
    }

    const signer = statusAfterId(run.status, 'GOODSIG') ?? 'unknown';

    return sealed({
      tool: VERIFY.id,
      status: 'ok',
      summary: `signature is valid for ${input} (key ${fingerprint.slice(0, 16)})`,
      data: {
        input,
        signature,
        valid: true,
        fingerprint,
        signer,
        backend: PROGRAM,
      },
      duration_ms: Date.now() - started,
    });
  },
};

export const gpgEncrypt: LocalTool = {
  manifest: ENCRYPT,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const input = requireString(args, 'input');
    await requireFile(ctx, input);

    const recipient = requireString(args, 'recipient');
    const overwrite = booleanOr(args, 'overwrite', false);
    const target = optString(args, 'output') ?? `${input}.gpg`;

    if (target === input) throw invalidArgs(`output ${target} is the input file; choose another path`);
    if (!ctx.dryRun && !overwrite && (await ctx.host.exists(target))) {
      throw io(`${target} already exists (use overwrite=true to replace it)`);
    }

    const command = [
      '--batch',
      '--no-tty',
      // The user named this recipient explicitly, so a locally imported key must
      // be usable without first being "trusted" interactively.
      '--trust-model',
      'always',
      '--output',
      target,
      '--encrypt',
      '--recipient',
      recipient,
    ];
    if (overwrite) command.push('--yes');
    command.push(input);

    if (ctx.dryRun) {
      return sealed({
        tool: ENCRYPT.id,
        status: 'ok',
        summary: `would encrypt ${input} for ${recipient} → ${target}`,
        data: { input, output: null, recipient, output_bytes: 0, backend: PROGRAM, dry_run: true },
        duration_ms: Date.now() - started,
      });
    }

    const run = await runGpg(ctx, optString(args, 'homedir'), command);
    if (!run.success) throw toolFailed(`${PROGRAM} failed: ${complaint(run.stderr)}`);

    const info = await ctx.host.stat(target);
    return sealed({
      tool: ENCRYPT.id,
      status: 'ok',
      summary: `encrypted ${input} for ${recipient} → ${target} (${info.size} bytes)`,
      data: {
        input,
        output: target,
        recipient,
        output_bytes: info.size,
        backend: PROGRAM,
        dry_run: false,
      },
      duration_ms: Date.now() - started,
    });
  },
};

export const GPG_TOOLS: readonly LocalTool[] = [gpgVerify, gpgEncrypt];
