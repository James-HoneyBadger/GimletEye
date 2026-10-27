/**
 * PNG chunk walker.
 *
 * Removable: `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`. Everything that affects
 * rendering is kept, and because chunks are independently CRC'd, removal needs
 * no re-encoding — the surviving chunks are byte-identical.
 */

import {
  isRemovable,
  PNG_SIGNATURE,
  stripRanges,
  type RemovalPolicy,
  type ScanResult,
  type Segment,
  type SegmentCategory,
} from './format.js';

export function scanPng(bytes: Buffer): ScanResult {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG (bad signature)');
  }

  const segments: Segment[] = [];
  let metadataBytes = 0;
  let pos = PNG_SIGNATURE.length;

  while (pos + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const kind = bytes.subarray(pos + 4, pos + 8).toString('latin1');
    const total = 12 + length;
    if (pos + total > bytes.length) {
      throw new Error(`malformed PNG: truncated '${kind}' chunk at offset ${pos}`);
    }

    const { label, category } = classifyPng(kind);
    if (isRemovable(category)) metadataBytes += total;
    segments.push({ kind, label, category, offset: pos, size: total });
    pos += total;

    if (kind === 'IEND') break;
  }

  if (segments.length === 0) throw new Error('malformed PNG: no chunks found');
  return { format: 'png', segments, metadata_bytes: metadataBytes };
}

export function stripPng(bytes: Buffer, policy: RemovalPolicy): Buffer {
  return stripRanges(bytes, scanPng(bytes), policy);
}

function classifyPng(kind: string): { label: string; category: SegmentCategory } {
  switch (kind) {
    case 'IHDR':
      return { label: 'Image header', category: 'structural' };
    case 'PLTE':
      return { label: 'Palette', category: 'structural' };
    case 'IDAT':
      return { label: 'Image data', category: 'structural' };
    case 'IEND':
      return { label: 'End of image', category: 'structural' };
    case 'tEXt':
      return { label: 'Uncompressed text', category: 'text' };
    case 'zTXt':
      return { label: 'Compressed text', category: 'text' };
    case 'iTXt':
      return { label: 'International text', category: 'text' };
    case 'eXIf':
      return { label: 'EXIF', category: 'identity' };
    case 'tIME':
      return { label: 'Last modified time', category: 'time' };
    case 'gAMA':
      return { label: 'Gamma', category: 'color' };
    case 'cHRM':
      return { label: 'Chromaticity', category: 'color' };
    case 'sRGB':
      return { label: 'sRGB rendering intent', category: 'color' };
    case 'iCCP':
      return { label: 'ICC profile', category: 'color' };
    case 'pHYs':
      return { label: 'Pixel dimensions', category: 'color' };
    case 'bKGD':
      return { label: 'Background colour', category: 'color' };
    case 'sBIT':
      return { label: 'Significant bits', category: 'color' };
    case 'tRNS':
      return { label: 'Transparency', category: 'color' };
    default:
      return { label: kind, category: 'structural' };
  }
}
