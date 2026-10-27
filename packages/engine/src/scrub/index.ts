/**
 * The scrub surface: identify, describe, and strip.
 *
 * Detection is by magic bytes, never by extension: a `.jpg` that is really a
 * PNG must not be mis-stripped.
 */

import { detect, stripRanges, type Format, type RemovalPolicy, type ScanResult } from './format.js';
import { scanJpeg, stripJpeg } from './jpeg.js';
import { scanPng, stripPng } from './png.js';
import { scanWebp, stripWebp } from './webp.js';

export * from './format.js';

export function scan(bytes: Buffer): ScanResult {
  switch (detect(bytes)) {
    case 'jpeg':
      return scanJpeg(bytes);
    case 'png':
      return scanPng(bytes);
    case 'webp':
      return scanWebp(bytes);
    default:
      throw new Error(
        'unrecognised container; native support covers JPEG, PNG, and WebP ' +
          '(install a metadata pack for HEIC, AVIF, TIFF, PDF, MP4, RAW, and others)',
      );
  }
}

export function strip(bytes: Buffer, policy: RemovalPolicy): Buffer {
  switch (detect(bytes)) {
    case 'jpeg':
      return stripJpeg(bytes, policy);
    case 'png':
      return stripPng(bytes, policy);
    case 'webp':
      return stripWebp(bytes, policy);
    default:
      return stripRanges(bytes, scan(bytes), policy);
  }
}

export function formatOf(bytes: Buffer): Format {
  const format = detect(bytes);
  if (format === undefined) throw new Error('unrecognised container');
  return format;
}
