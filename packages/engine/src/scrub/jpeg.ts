/**
 * JPEG segment walker.
 *
 * Removable: EXIF and XMP (APP1), IPTC/Photoshop (APP13), Ducky (APP12), and
 * COM. Kept: JFIF (APP0), ICC profile (APP2), MPF (APP2 multi-picture index),
 * Adobe colour transform (APP14), and everything from the start-of-scan marker
 * onward — ICC and the Adobe marker change how pixels are interpreted, and MPF
 * holds offsets to secondary images, so removing any of them corrupts the file.
 */

import {
  isRemovable,
  stripRanges,
  type RemovalPolicy,
  type ScanResult,
  type Segment,
  type SegmentCategory,
} from './format.js';

export function scanJpeg(bytes: Buffer): ScanResult {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('not a JPEG (missing SOI)');
  }

  const segments: Segment[] = [];
  let metadataBytes = 0;
  let pos = 2;

  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      throw new Error(`malformed JPEG: expected a marker at offset ${pos}`);
    }
    const marker = bytes[pos + 1] as number;

    if (marker === 0xd8) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      segments.push({
        kind: 'SOS',
        label: 'Start of scan (pixel data)',
        category: 'structural',
        offset: pos,
        size: bytes.length - pos,
      });
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }

    if (pos + 4 > bytes.length) break;
    const length = bytes.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > bytes.length) {
      throw new Error(`malformed JPEG: truncated segment at offset ${pos}`);
    }
    const payload = bytes.subarray(pos + 4, pos + 2 + length);
    const { kind, label, category } = classifyJpeg(marker, payload);

    if (isRemovable(category)) metadataBytes += length + 2;
    segments.push({ kind, label, category, offset: pos, size: length + 2 });
    pos += 2 + length;
  }

  if (segments.length === 0) throw new Error('malformed JPEG: no segments found');
  return { format: 'jpeg', segments, metadata_bytes: metadataBytes };
}

export function stripJpeg(bytes: Buffer, policy: RemovalPolicy): Buffer {
  return stripRanges(bytes, scanJpeg(bytes), policy);
}

function classifyJpeg(marker: number, payload: Buffer): { kind: string; label: string; category: SegmentCategory } {
  const starts = (prefix: string): boolean => payload.subarray(0, prefix.length).toString('latin1') === prefix;

  switch (marker) {
    case 0xe0: {
      const label = starts('JFIF') ? 'JFIF' : starts('JFXX') ? 'JFIF extension' : 'APP0';
      return { kind: 'APP0', label, category: 'structural' };
    }
    case 0xe1: {
      if (starts('Exif\0\0')) return { kind: 'APP1', label: 'EXIF (including GPS)', category: 'identity' };
      if (starts('http://ns.adobe.com/xap/1.0/')) return { kind: 'APP1', label: 'XMP', category: 'identity' };
      return { kind: 'APP1', label: 'APP1', category: 'identity' };
    }
    case 0xe2: {
      if (starts('ICC_PROFILE')) return { kind: 'APP2', label: 'ICC profile', category: 'color' };
      if (starts('MPF\0')) return { kind: 'APP2', label: 'MPF (multi-picture index)', category: 'structural' };
      return { kind: 'APP2', label: 'APP2', category: 'structural' };
    }
    case 0xec:
      return { kind: 'APP12', label: 'Ducky / APP12', category: 'identity' };
    case 0xed:
      return { kind: 'APP13', label: 'IPTC / Photoshop', category: 'identity' };
    case 0xee:
      return { kind: 'APP14', label: 'Adobe colour transform', category: 'color' };
    case 0xfe:
      return { kind: 'COM', label: 'Comment', category: 'text' };
    default: {
      const name = markerName(marker);
      return { kind: name, label: name, category: 'structural' };
    }
  }
}

function markerName(marker: number): string {
  switch (marker) {
    case 0xc0:
      return 'SOF0';
    case 0xc2:
      return 'SOF2';
    case 0xc4:
      return 'DHT';
    case 0xdb:
      return 'DQT';
    case 0xdd:
      return 'DRI';
    default:
      return `0x${marker.toString(16).toUpperCase().padStart(2, '0')}`;
  }
}
