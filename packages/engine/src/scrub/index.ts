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
export * from './gps.js';

/** The one refusal for a format this build cannot read. */
function unrecognised(): never {
  throw new Error(
    'unrecognised container; this build reads JPEG, PNG, and WebP ' +
      '(HEIC, AVIF, TIFF, PDF, MP4, and RAW are not implemented)',
  );
}

export function scan(bytes: Buffer): ScanResult {
  switch (detect(bytes)) {
    case 'jpeg':
      return scanJpeg(bytes);
    case 'png':
      return scanPng(bytes);
    case 'webp':
      return scanWebp(bytes);
    default:
      return unrecognised();
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
      // `scan` throws for the same input, so the old fallback here was a branch
      // that could never run and implied a format it did not have.
      return unrecognised();
  }
}

export function formatOf(bytes: Buffer): Format {
  const format = detect(bytes);
  if (format === undefined) throw new Error('unrecognised container');
  return format;
}
