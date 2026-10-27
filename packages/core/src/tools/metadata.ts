/**
 * Metadata inspection and verification, over the engine's scrub model.
 *
 * These two are read-only on purpose: they are the pair a person runs before
 * and after a strip, and the one a CI job runs to fail a build that still ships
 * a GPS tag. The stripping tool stays with the engine until GPS redaction is
 * ported, so migrating these cannot weaken anything.
 */

import {
  describe,
  metadataLabels,
  planned,
  plannedLabels,
  policyProfile,
  removableBytes,
  scan,
  withOverrides,
  type RemovalPolicy,
} from '@gimlet-eye/engine';

import { optString, requireString, stringOr } from '../args.js';
import { invalidArgs, notFound } from '../errors.js';
import { sealed, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ArgSpec, ToolManifest } from '../manifest.js';

function policyArgs(inputHelp: string): ArgSpec[] {
  return [
    { name: 'input', type: 'path', required: true, help: inputHelp },
    {
      name: 'profile',
      type: 'enum',
      values: ['privacy', 'sharing', 'archive'],
      default: 'privacy',
      help: 'privacy removes identity, text, and time; sharing keeps time; archive keeps all',
    },
    {
      name: 'remove',
      type: 'string',
      help: 'Comma-separated kinds or labels to remove regardless of profile (e.g. EXIF,tEXt)',
    },
    { name: 'keep', type: 'string', help: 'Comma-separated kinds or labels to keep; always wins over remove' },
  ];
}

const SCAN_MANIFEST: ToolManifest = {
  id: 'privacy.metadata-scan',
  title: 'Inspect metadata',
  summary: 'Report embedded EXIF, GPS, text, and comment regions in a container',
  category: 'privacy',
  capabilities: ['fs:read'],
  args: policyArgs('File to inspect'),
  tags: ['metadata', 'exif', 'inspection'],
};

const VERIFY_MANIFEST: ToolManifest = {
  id: 'privacy.metadata-verify',
  title: 'Verify metadata removal',
  summary: 'Assert that a file carries no metadata selected by the policy',
  category: 'privacy',
  capabilities: ['fs:read'],
  args: policyArgs('File to verify'),
  tags: ['metadata', 'verification', 'ci'],
};

export const metadataScan: LocalTool = {
  manifest: SCAN_MANIFEST,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const path = requireString(args, 'input');
    const policy = policyFromArgs(args);
    const bytes = await readInput(ctx, path);
    const result = scan(bytes);
    const removable = removableBytes(result, policy);

    const findings =
      removable > 0
        ? [
            {
              severity: 'medium' as const,
              code: 'metadata.present',
              message: `${removable} bytes removable under this policy: ${plannedLabels(result, policy).join(', ')}`,
            },
          ]
        : [];

    return sealed({
      tool: SCAN_MANIFEST.id,
      status: 'ok',
      summary: `${path} · ${result.format} · ${result.segments.length} segments · ${removable} bytes removable (${describe(policy)})`,
      findings,
      data: {
        path,
        format: result.format,
        size_bytes: bytes.length,
        metadata_bytes: result.metadata_bytes,
        removable_bytes: removable,
        policy: describe(policy),
        labels: metadataLabels(result),
        segments: result.segments,
      },
      duration_ms: Date.now() - started,
    });
  },
};

export const metadataVerify: LocalTool = {
  manifest: VERIFY_MANIFEST,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const path = requireString(args, 'input');
    const policy = policyFromArgs(args);
    const bytes = await readInput(ctx, path);
    const result = scan(bytes);
    const removable = removableBytes(result, policy);

    const findings =
      removable > 0
        ? [
            {
              severity: 'high' as const,
              code: 'metadata.remaining',
              message: `${path} still carries ${removable} bytes of metadata: ${plannedLabels(result, policy).join(', ')}`,
            },
          ]
        : [];

    return sealed({
      tool: VERIFY_MANIFEST.id,
      status: 'ok',
      summary:
        removable === 0
          ? `${path} is clean under ${describe(policy)} (${result.format})`
          : `${path} carries metadata (${describe(policy)})`,
      findings,
      data: {
        path,
        format: result.format,
        metadata_bytes: result.metadata_bytes,
        removable_bytes: removable,
        policy: describe(policy),
        removable_segments: planned(result, policy).map((segment) => segment.kind),
      },
      duration_ms: Date.now() - started,
    });
  },
};

function policyFromArgs(args: Args): RemovalPolicy {
  const profile = stringOr(args, 'profile', 'privacy');
  const remove = optString(args, 'remove');
  const keep = optString(args, 'keep');
  let base: RemovalPolicy;
  try {
    base = policyProfile(profile);
  } catch (error) {
    throw invalidArgs((error as Error).message);
  }
  return withOverrides(base, remove, keep);
}

async function readInput(ctx: ToolRunContext, path: string): Promise<Buffer> {
  if (!(await ctx.host.exists(path))) throw notFound(path);
  return Buffer.from(await ctx.host.readFile(path));
}
