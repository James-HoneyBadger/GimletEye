/**
 * The scrub model: what a container is made of, and which parts may go.
 *
 * Two rules carry the safety of this module. Only `identity`, `text`, and `time`
 * are ever removable — structure and colour decide what the pixels mean, so
 * removing them corrupts the file instead of privatising it. And a removal is
 * always a whole segment, copied around rather than rewritten, so a stripped
 * file cannot end up with a header that disagrees with its body.
 */

export type Format = 'jpeg' | 'png' | 'webp';

export type SegmentCategory = 'identity' | 'text' | 'time' | 'structural' | 'color';

export interface Segment {
  /** Container-specific tag, e.g. `APP1`, `tEXt`, `EXIF`. */
  kind: string;
  label: string;
  category: SegmentCategory;
  offset: number;
  size: number;
}

export interface ScanResult {
  format: Format;
  segments: Segment[];
  /** Bytes a remove-everything policy would drop. */
  metadata_bytes: number;
}

export const REMOVABLE: readonly SegmentCategory[] = ['identity', 'text', 'time'];

export function isRemovable(category: SegmentCategory): boolean {
  return REMOVABLE.includes(category);
}

export interface RemovalPolicy {
  categories: SegmentCategory[];
  /** Explicit removals, by kind or by label prefix. */
  remove: string[];
  /** Explicit keeps, which always win. */
  keep: string[];
}

/** Everything removable: what `privacy` means. */
export function policyAll(): RemovalPolicy {
  return { categories: ['identity', 'text', 'time'], remove: [], keep: [] };
}

export function policyNone(): RemovalPolicy {
  return { categories: [], remove: [], keep: [] };
}

export function policyProfile(name: string): RemovalPolicy {
  switch (name.trim().toLowerCase()) {
    case 'privacy':
      return policyAll();
    // Sharing keeps timestamps (useful for sorting and archives) but drops
    // identity, location, and text.
    case 'sharing':
      return { categories: ['identity', 'text'], remove: [], keep: [] };
    case 'archive':
      return policyNone();
    default:
      throw new Error(`unknown profile '${name}' (use privacy, sharing, or archive)`);
  }
}

/** `--remove a,b --keep c`: comma-separated, both applied on top of the profile. */
export function withOverrides(policy: RemovalPolicy, remove?: string, keep?: string): RemovalPolicy {
  return {
    categories: [...policy.categories],
    remove: [...policy.remove, ...splitList(remove)],
    keep: [...policy.keep, ...splitList(keep)],
  };
}

export function shouldRemove(policy: RemovalPolicy, segment: Segment): boolean {
  if (!isRemovable(segment.category)) return false;
  if (policy.keep.some((needle) => matches(needle, segment))) return false;
  if (policy.remove.some((needle) => matches(needle, segment))) return true;
  return policy.categories.includes(segment.category);
}

export function describe(policy: RemovalPolicy): string {
  const parts = policy.categories.length === 0 ? ['none'] : policy.categories.map(String);
  let text = parts.join(', ');
  if (policy.remove.length > 0) text += ` (+remove: ${policy.remove.join(',')})`;
  if (policy.keep.length > 0) text += ` (keep: ${policy.keep.join(',')})`;
  return text;
}

export function planned(scan: ScanResult, policy: RemovalPolicy): Segment[] {
  return scan.segments.filter((segment) => shouldRemove(policy, segment));
}

export function removableBytes(scan: ScanResult, policy: RemovalPolicy): number {
  return planned(scan, policy).reduce((total, segment) => total + segment.size, 0);
}

export function plannedLabels(scan: ScanResult, policy: RemovalPolicy): string[] {
  const labels = planned(scan, policy).map((segment) => segment.label);
  return [...new Set(labels)].sort();
}

export function metadataLabels(scan: ScanResult): string[] {
  const labels = scan.segments.filter((segment) => isRemovable(segment.category)).map((segment) => segment.label);
  return [...new Set(labels)].sort();
}

/** Copy every byte the policy keeps, in order. Removed ranges are whole segments. */
export function stripRanges(bytes: Buffer, scan: ScanResult, policy: RemovalPolicy): Buffer {
  const removed = planned(scan, policy);
  const pieces: Buffer[] = [];
  let cursor = 0;
  for (const segment of removed) {
    if (segment.offset < cursor) continue;
    pieces.push(bytes.subarray(cursor, segment.offset));
    cursor = segment.offset + segment.size;
  }
  pieces.push(bytes.subarray(Math.min(cursor, bytes.length)));
  return Buffer.concat(pieces);
}

export function detect(bytes: Buffer): Format | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return undefined;
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function matches(needle: string, segment: Segment): boolean {
  const want = needle.trim().toLowerCase();
  return want !== '' && (segment.kind.toLowerCase() === want || segment.label.toLowerCase().startsWith(want));
}

function splitList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
