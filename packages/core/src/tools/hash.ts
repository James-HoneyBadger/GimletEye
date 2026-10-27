/**
 * SHA-256 over text or a file.
 *
 * Ported from the engine: same manifest, same argument names, same report keys,
 * because a tool is its identifier and its output shape, not its language.
 */

import { sha256Hex } from '@gimlet-eye/engine';

import { optString, requireString } from '../args.js';
import { invalidArgs, notFound } from '../errors.js';
import { sealed, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const MANIFEST: ToolManifest = {
  id: 'crypto.sha256',
  title: 'SHA-256 digest',
  summary: 'Hash text or a file with SHA-256',
  category: 'crypto',
  capabilities: ['fs:read'],
  args: [
    { name: 'path', type: 'path', help: 'File to hash' },
    { name: 'text', type: 'string', help: 'Literal text to hash' },
  ],
  tags: ['hash', 'integrity', 'fingerprint'],
};

export const sha256: LocalTool = {
  manifest: MANIFEST,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const path = optString(args, 'path');
    const text = optString(args, 'text');

    if (path !== undefined && text !== undefined) {
      throw invalidArgs("provide either 'path' or 'text', not both");
    }
    if (path === undefined && text === undefined) {
      throw invalidArgs("one of 'path' or 'text' is required");
    }

    let digest: string;
    let size: number;
    let source: string;
    if (path !== undefined) {
      if (!(await ctx.host.exists(path))) throw notFound(path);
      const bytes = await ctx.host.readFile(path);
      digest = sha256Hex(bytes);
      size = bytes.length;
      source = path;
    } else {
      const bytes = Buffer.from(requireString(args, 'text'), 'utf8');
      digest = sha256Hex(bytes);
      size = bytes.length;
      source = 'text';
    }

    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary: `sha256:${digest}`,
      data: { sha256: digest, size_bytes: size, source, backend: 'node' },
      duration_ms: Date.now() - started,
    });
  },
};
