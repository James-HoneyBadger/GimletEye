/**
 * Password generation, over the engine's generator.
 *
 * The report shape is the engine's: `passwords`, `length`, `alphabet_size`,
 * `entropy_bits`. The finding at the bottom is the point of the tool — it is
 * how a caller learns that an 8-character password is not a stored secret.
 */

import { generatePasswords } from '@gimlet-eye/engine';

import { booleanOr, integerOr } from '../args.js';
import { sealed, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const MANIFEST: ToolManifest = {
  id: 'crypto.passgen',
  title: 'Generate passwords',
  summary: 'Cryptographically secure passwords with an estimated entropy budget',
  category: 'crypto',
  capabilities: ['secrets'],
  args: [
    { name: 'length', type: 'integer', default: 24, help: 'Characters per password (8-256)' },
    { name: 'count', type: 'integer', default: 1, help: 'How many passwords to produce (1-256)' },
    { name: 'symbols', type: 'boolean', default: true },
    { name: 'no_ambiguous', type: 'boolean', default: false, help: 'Exclude characters that look alike (Il1O0o)' },
  ],
  data: {
    shape: 'object',
    required: {
    alphabet_size: 'number',
    backend: 'string',
    entropy_bits: 'number',
    length: 'number',
    passwords: 'array',
    },
  },
  tags: ['secrets', 'entropy', 'generator'],
};

export const passgen: LocalTool = {
  manifest: MANIFEST,
  async run(_ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const result = generatePasswords({
      length: integerOr(args, 'length', 24),
      count: integerOr(args, 'count', 1),
      symbols: booleanOr(args, 'symbols', true),
      noAmbiguous: booleanOr(args, 'no_ambiguous', false),
    });

    const findings = result.low_entropy
      ? [
          {
            severity: 'medium' as const,
            code: 'passgen.low_entropy',
            message: `~${result.entropy_bits} bits is below the 60-bit guidance for stored secrets`,
          },
        ]
      : [];

    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary: `${result.passwords.length} password(s) · ${result.length} chars · ~${result.entropy_bits} bits each`,
      findings,
      data: {
        passwords: result.passwords,
        length: result.length,
        alphabet_size: result.alphabet_size,
        entropy_bits: result.entropy_bits,
        backend: 'node',
      },
      duration_ms: Date.now() - started,
    });
  },
};
