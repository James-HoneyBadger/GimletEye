/**
 * WebP (RIFF container) walker.
 *
 * Removable: `EXIF` and `XMP ` chunks. When the file has a `VP8X` header, the
 * corresponding presence flags are cleared — but only for chunks actually
 * removed, so an `archive` profile leaves the header truthful. The RIFF size
 * field is rewritten because chunks were taken out; nothing else is touched.
 */

import {
  isRemovable,
  shouldRemove,
  stripRanges,
  type RemovalPolicy,
  type ScanResult,
  type Segment,
  type SegmentCategory,
} from './format.js';

export function scanWebp(bytes: Buffer): ScanResult {
  if (bytes.length < 12 || bytes.subarray(0, 4).toString('latin1') !== 'RIFF' || bytes.subarray(8, 12).toString('latin1') !== 'WEBP') {
    throw new Error('not a WebP (bad RIFF header)');
  }

  const segments: Segment[] = [];
  let metadataBytes = 0;
  let pos = 12;

  while (pos + 8 <= bytes.length) {
    const fourcc = bytes.subarray(pos, pos + 4).toString('latin1');
    const size = bytes.readUInt32LE(pos + 4);
    const padded = size + (size % 2);
    const total = 8 + padded;
    if (pos + total > bytes.length) {
      throw new Error(`malformed WebP: truncated '${fourcc}' chunk at offset ${pos}`);
    }

    const { label, category } = classifyWebp(fourcc);
    if (isRemovable(category)) metadataBytes += total;
    segments.push({ kind: fourcc, label, category, offset: pos, size: total });
    pos += total;
  }

  if (segments.length === 0) throw new Error('malformed WebP: no chunks found');
  return { format: 'webp', segments, metadata_bytes: metadataBytes };
}

export function stripWebp(bytes: Buffer, policy: RemovalPolicy): Buffer {
  const scan = scanWebp(bytes);

  const clearsExif = scan.segments.some((segment) => segment.kind === 'EXIF' && shouldRemove(policy, segment));
  const clearsXmp = scan.segments.some((segment) => segment.kind === 'XMP ' && shouldRemove(policy, segment));

  // An archive profile removes nothing, so the generic copier is byte-exact.
  if (!clearsExif && !clearsXmp) return stripRanges(bytes, scan, policy);

  const pieces: Buffer[] = [Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')];
  for (const segment of scan.segments) {
    if (shouldRemove(policy, segment)) continue;
    const chunk = bytes.subarray(segment.offset, segment.offset + segment.size);
    if (segment.kind === 'VP8X' && segment.size >= 9) {
      // Clear only the flags for chunks actually removed.
      const copy = Buffer.from(chunk);
      if (clearsExif) copy[8] = (copy[8] as number) & ~0x08;
      if (clearsXmp) copy[8] = (copy[8] as number) & ~0x04;
      pieces.push(copy);
    } else {
      pieces.push(chunk);
    }
  }

  const out = Buffer.concat(pieces);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

function classifyWebp(fourcc: string): { label: string; category: SegmentCategory } {
  switch (fourcc) {
    case 'VP8 ':
      return { label: 'Lossy image data', category: 'structural' };
    case 'VP8L':
      return { label: 'Lossless image data', category: 'structural' };
    case 'VP8X':
      return { label: 'Extended header', category: 'structural' };
    case 'ALPH':
      return { label: 'Alpha channel', category: 'structural' };
    case 'ANIM':
      return { label: 'Animation parameters', category: 'structural' };
    case 'ANMF':
      return { label: 'Animation frame', category: 'structural' };
    case 'ICCP':
      return { label: 'ICC profile', category: 'color' };
    case 'EXIF':
      return { label: 'EXIF (including GPS)', category: 'identity' };
    case 'XMP ':
      return { label: 'XMP', category: 'identity' };
    default:
      return { label: fourcc, category: 'structural' };
  }
}
