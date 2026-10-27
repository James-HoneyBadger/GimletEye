/**
 * Metadata inspection and verification, over the engine's scrub model.
 *
 * Scan and verify are read-only on purpose: they are the pair a person runs
 * before and after a strip, and the one a CI job runs to fail a build that still
 * ships a GPS tag.
 *
 * Strip is the third: the only tool in the kit that rewrites a file a user
 * cares about, so it refuses more than it accepts. The output name derives from
 * the input, an existing file is never replaced without `overwrite`, rewriting
 * the source needs `in_place` explicitly, the result is re-scanned before it is
 * written (a strip that fails to strip is a privacy bug, not a warning), and it
 * lands by rename so a failure halfway cannot leave a truncated photo behind.
 */

import {
  describe,
  formatOf,
  GPS_PRECISIONS,
  metadataLabels,
  parseGpsPrecision,
  planned,
  plannedLabels,
  policyProfile,
  redactGps,
  removableBytes,
  scan,
  shouldRemove,
  strip,
  withOverrides,
  type GpsRedaction,
  type RemovalPolicy,
} from '@gimlet-eye/engine';

import { booleanOr, optString, requireString, stringOr } from '../args.js';
import { invalidArgs, io, notFound, toolFailed } from '../errors.js';
import { basename, dirname, extension, join, normalize, stem } from '../pathutil.js';
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

const STRIP_MANIFEST: ToolManifest = {
  id: 'privacy.metadata-strip',
  title: 'Remove metadata',
  summary: 'Rewrite a file without selected metadata, optionally reducing GPS precision instead of deleting it',
  category: 'privacy',
  capabilities: ['fs:read', 'fs:write'],
  args: [
    { name: 'input', type: 'path', required: true, help: 'File to clean' },
    { name: 'output', type: 'path', help: 'Destination path' },
    { name: 'in_place', type: 'boolean', default: false, help: 'Overwrite the input file' },
    { name: 'overwrite', type: 'boolean', default: false, help: 'Replace the output file if it exists' },
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
    {
      name: 'redact_gps',
      type: 'enum',
      values: [...GPS_PRECISIONS],
      default: 'off',
      help: 'Reduce GPS precision in place instead of deleting EXIF (off, country, region, city)',
    },
  ],
  tags: ['metadata', 'exif', 'gps', 'privacy', 'batch'],
  mutates: true,
};

export const metadataStrip: LocalTool = {
  manifest: STRIP_MANIFEST,
  async run(ctx: ToolRunContext, args: Args): Promise<Report> {
    const started = Date.now();
    const input = requireString(args, 'input');
    const bytes = await readInput(ctx, input);
    const inPlace = booleanOr(args, 'in_place', false);
    const overwrite = booleanOr(args, 'overwrite', false);
    const policy = policyFromArgs(args);
    const precision = gpsFromArgs(args);
    const target = await targetPath(ctx, input, args, inPlace);

    // Rewriting the source in place is a decision the caller makes with
    // `in_place`; an `output` that happens to be the input would destroy it by
    // accident, since the rewrite starts from bytes already read.
    if (!inPlace && (await sameFile(ctx, input, target))) {
      throw invalidArgs(`output ${target} is the input file; use in_place=true to rewrite it`);
    }

    const before = scanOrFail(bytes, input);
    const plannedBefore = removableBytes(before, policy);

    const working = Buffer.from(bytes);
    const warnings: string[] = [];
    let gps: GpsRedaction | undefined;

    if (precision !== 'off') {
      try {
        gps = redactGps(working, precision);
      } catch (error) {
        throw toolFailed((error as Error).message);
      }
      if (gps === undefined) {
        warnings.push(`no GPS coordinates found; nothing to redact at '${precision}' precision`);
      } else if (
        before.segments.some(
          (segment) =>
            segment.category === 'identity' &&
            segment.label.toUpperCase().includes('EXIF') &&
            shouldRemove(policy, segment),
        )
      ) {
        warnings.push(
          `GPS was redacted to ${gps.precision} but the policy also removes EXIF, ` +
            'so the coordinates are gone entirely',
        );
      }
    }

    const cleaned = stripBytes(working, policy);
    verifyClean(cleaned, policy);

    const changed = !cleaned.equals(bytes);
    if (!changed && plannedBefore === 0) {
      return sealed({
        tool: STRIP_MANIFEST.id,
        status: 'ok',
        summary: `${input} already carries no removable metadata (${describe(policy)})`,
        data: {
          input,
          output: null,
          format: before.format,
          removed_bytes: 0,
          policy: { ...policy, description: describe(policy) },
          gps: gps ?? null,
          dry_run: ctx.dryRun,
        },
        warnings,
        duration_ms: Date.now() - started,
      });
    }

    if (!ctx.dryRun && changed) {
      // `in_place` is the explicit permission to replace the input; every other
      // destination is only replaceable on request.
      if (!inPlace && (await ctx.host.exists(target)) && !overwrite) {
        throw io(`${target} already exists (use overwrite=true to replace it)`);
      }
      await writeAtomic(ctx, target, cleaned);
    }

    return sealed({
      tool: STRIP_MANIFEST.id,
      status: 'ok',
      summary:
        `${ctx.dryRun ? 'would clean' : 'cleaned'} ${input} — ` +
        `removed ${bytes.length - cleaned.length} bytes (${describe(policy)})` +
        (gps === undefined ? '' : ` · GPS reduced to ${gps.precision}`),
      data: {
        input,
        output: ctx.dryRun || !changed ? null : target,
        format: before.format,
        original_bytes: bytes.length,
        cleaned_bytes: cleaned.length,
        removed_bytes: bytes.length - cleaned.length,
        policy: { ...policy, description: describe(policy) },
        gps: gps ?? null,
        dry_run: ctx.dryRun,
      },
      warnings,
      duration_ms: Date.now() - started,
    });
  },
};

function gpsFromArgs(args: Args): ReturnType<typeof parseGpsPrecision> {
  const value = optString(args, 'redact_gps');
  if (value === undefined) return 'off';
  try {
    return parseGpsPrecision(value);
  } catch (error) {
    throw invalidArgs((error as Error).message);
  }
}

async function targetPath(ctx: ToolRunContext, input: string, args: Args, inPlace: boolean): Promise<string> {
  const output = optString(args, 'output');
  if (inPlace && output !== undefined) throw invalidArgs("'in_place' and 'output' are mutually exclusive");
  if (inPlace) return input;
  if (output !== undefined) return output;
  const suffix = extension(input);
  return join(dirname(input), `${stem(input)}.clean${suffix === '' ? '' : `.${suffix}`}`);
}

/**
 * Do two paths name the same file? Canonicalised when both exist, so a relative
 * spelling of the input is still recognised as the input.
 */
async function sameFile(ctx: ToolRunContext, left: string, right: string): Promise<boolean> {
  if (normalize(left) === normalize(right)) return true;
  try {
    return (await ctx.host.resolve(left)) === (await ctx.host.resolve(right));
  } catch {
    return false;
  }
}

function scanOrFail(bytes: Buffer, input: string): ReturnType<typeof scan> {
  try {
    return scan(bytes);
  } catch (error) {
    throw toolFailed(`${input}: ${(error as Error).message}`);
  }
}

function stripBytes(bytes: Buffer, policy: RemovalPolicy): Buffer {
  try {
    return strip(bytes, policy);
  } catch (error) {
    throw toolFailed((error as Error).message);
  }
}

/** Re-scan the output before it is written: a strip that fails to strip is a
 * privacy bug, so it must surface as an error rather than a warning. */
function verifyClean(cleaned: Buffer, policy: RemovalPolicy): void {
  let remaining: number;
  let format: string;
  try {
    const after = scan(cleaned);
    remaining = removableBytes(after, policy);
    format = formatOf(cleaned);
  } catch (error) {
    throw toolFailed(`strip left no readable container: ${(error as Error).message}`);
  }
  if (remaining > 0) throw toolFailed(`strip incomplete for ${format}: ${remaining} bytes of metadata remain`);
}

/**
 * Write beside the destination and rename into place.
 *
 * A strip that stops halfway — a full disk, a signal, a bug — must not leave a
 * truncated photo at the destination, and with `in_place` the destination is the
 * only copy, so the bytes land by rename or not at all.
 *
 * An existing destination keeps its permission bits: rewriting a file must never
 * be the reason it became readable by someone else, and `in_place` on a `0600`
 * photo leaves it `0600`. A new file gets whatever the umask gives it, which is
 * what writing any other new file does — a cleaned photo is meant to be shared.
 */
async function writeAtomic(ctx: ToolRunContext, target: string, bytes: Buffer): Promise<void> {
  const temp = join(dirname(target), `${basename(target)}.tmp`);
  try {
    const keep = await ctx.host.mode(target);
    await ctx.host.writeFile(temp, new Uint8Array(bytes));
    if (keep !== undefined) await ctx.host.chmod(temp, keep);
    await ctx.host.rename(temp, target);
  } catch (error) {
    await ctx.host.removeTree(temp).catch(() => undefined);
    throw io(`could not write ${target}: ${(error as Error).message}`);
  }
}

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
