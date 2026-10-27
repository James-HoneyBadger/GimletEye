/**
 * EXIF GPS redaction.
 *
 * Deleting EXIF outright is the safe default, but it also throws away camera,
 * lens, and date information people often want to keep. Redaction is the
 * narrower tool: rewrite the coordinates to a coarser precision **in place**.
 * A `GPSLatitude` is three 8-byte RATIONALs, so the replacement is the same
 * size, no offset in the file moves, and the rest of the EXIF block survives.
 *
 * The two awkward properties below were both found by the Rust fuzz target and
 * are kept deliberately: redaction is idempotent (a second pass must not move
 * the coordinate again), and a payload whose structures share bytes is refused
 * rather than half-written.
 */

import { detect, type Format, type ScanResult } from './format.js';
import { scanJpeg } from './jpeg.js';
import { scanPng } from './png.js';
import { scanWebp } from './webp.js';

/** How much location precision to keep. */
export type GpsPrecision = 'off' | 'country' | 'region' | 'city';

export const GPS_PRECISIONS: readonly GpsPrecision[] = ['off', 'country', 'region', 'city'];

export function parseGpsPrecision(value: string): GpsPrecision {
  const name = value.trim().toLowerCase();
  if (name === 'off' || name === 'none' || name === '') return 'off';
  if (name === 'country' || name === 'region' || name === 'city') return name;
  throw new Error(`unknown GPS precision '${name}' (use off, country, region, or city)`);
}

/** ~111 km at country, ~11 km at region, ~1.1 km at city. */
const COORDINATE_GRID_SECONDS: Record<GpsPrecision, number | undefined> = {
  off: undefined,
  country: 3600,
  region: 360,
  city: 36,
};

const ALTITUDE_GRID_METRES: Record<GpsPrecision, number> = {
  off: 0,
  country: 1000,
  region: 100,
  city: 10,
};

/** What the redaction did. Only post-redaction values: echoing the original
 * coordinates would defeat the purpose. */
export interface GpsRedaction {
  precision: GpsPrecision;
  latitude: number;
  longitude: number;
  altitude_metres?: number;
}

const TAG_GPS_IFD = 0x8825;
const TAG_GPS_LATITUDE_REF = 1;
const TAG_GPS_LATITUDE = 2;
const TAG_GPS_LONGITUDE_REF = 3;
const TAG_GPS_LONGITUDE = 4;
const TAG_GPS_ALTITUDE_REF = 5;
const TAG_GPS_ALTITUDE = 6;

const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

function malformed(detail: string): Error {
  return new Error(`cannot redact GPS: ${detail}`);
}

/** Byte ranges of every EXIF payload in the container. */
export function exifRanges(bytes: Buffer): Array<{ start: number; end: number }> {
  const format: Format | undefined = detect(bytes);
  if (format === undefined) throw malformed('unrecognised container');

  const ranges: Array<{ start: number; end: number }> = [];
  for (const segment of scanAs(format, bytes).segments) {
    let start: number;
    let end: number;
    if (format === 'jpeg' && segment.kind === 'APP1' && segment.label.startsWith('EXIF')) {
      // Marker (2) + length (2) precede the payload.
      start = segment.offset + 4;
      end = segment.offset + segment.size;
    } else if (format === 'png' && segment.kind === 'eXIf') {
      // length (4) + type (4) precede the payload.
      start = segment.offset + 8;
      end = start + bytes.readUInt32BE(segment.offset);
    } else if (format === 'webp' && segment.kind === 'EXIF') {
      // fourcc (4) + length (4) precede the payload.
      start = segment.offset + 8;
      end = start + bytes.readUInt32LE(segment.offset + 4);
    } else {
      continue;
    }

    if (end > bytes.length || start > end) throw malformed('EXIF segment extends past the end of the file');
    ranges.push({ start, end });
  }
  return ranges;
}

/** The container's own scanner. Spelled out here rather than imported from the
 * barrel, which imports this module. */
function scanAs(format: Format, bytes: Buffer): ScanResult {
  switch (format) {
    case 'jpeg':
      return scanJpeg(bytes);
    case 'png':
      return scanPng(bytes);
    case 'webp':
      return scanWebp(bytes);
  }
}

/**
 * Redact GPS in every EXIF block of the container, in place.
 *
 * Returns the last redaction applied, or `undefined` when the file carries no
 * coordinates — a file with several EXIF blocks (say a JPEG plus an embedded
 * thumbnail) reports one summary, since they are redacted identically.
 */
export function redactGps(bytes: Buffer, precision: GpsPrecision): GpsRedaction | undefined {
  if (COORDINATE_GRID_SECONDS[precision] === undefined) return undefined;
  let last: GpsRedaction | undefined;
  for (const { start, end } of exifRanges(bytes)) {
    const redaction = redactGpsPayload(bytes.subarray(start, end), precision);
    if (redaction !== undefined) last = redaction;
  }
  return last;
}

interface Plan {
  little: boolean;
  latitudeOffset?: number;
  longitudeOffset?: number;
  altitudeOffset?: number;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  latitudeRef?: string;
  longitudeRef?: string;
  /** `GPSAltitudeRef`: 0 (or absent) is above sea level, 1 below. EXIF stores
   * altitude as an unsigned magnitude, so this is where the sign lives. */
  altitudeRef?: number;
  /** IFD entry tables in payload coordinates: a value pointer may point into
   * one, and writing there edits the entries that were just read. */
  structure: Array<{ start: number; end: number }>;
}

interface TiffEntry {
  tag: number;
  fieldType: number;
  count: number;
  valueField: number;
}

class Tiff {
  constructor(
    private readonly bytes: Buffer,
    readonly little: boolean,
  ) {}

  static open(bytes: Buffer): Tiff {
    if (bytes.length < 8) throw malformed('TIFF header is truncated');
    const order = bytes.subarray(0, 2).toString('latin1');
    if (order !== 'II' && order !== 'MM') throw malformed('unknown TIFF byte order');
    const tiff = new Tiff(bytes, order === 'II');
    if (tiff.u16(2) !== 42) throw malformed('missing TIFF magic 42');
    return tiff;
  }

  slice(offset: number, length: number): Buffer {
    if (offset < 0 || length < 0 || offset + length > this.bytes.length) {
      throw malformed('EXIF structure is truncated');
    }
    return this.bytes.subarray(offset, offset + length);
  }

  u16(offset: number): number {
    const slice = this.slice(offset, 2);
    return this.little ? slice.readUInt16LE(0) : slice.readUInt16BE(0);
  }

  u32(offset: number): number {
    const slice = this.slice(offset, 4);
    return this.little ? slice.readUInt32LE(0) : slice.readUInt32BE(0);
  }

  ifdCount(ifd: number): number {
    const count = this.u16(ifd);
    if (count > 512) throw malformed('implausible IFD entry count');
    return count;
  }

  entry(ifd: number, index: number): TiffEntry {
    const base = ifd + 2 + index * 12;
    this.slice(base, 12);
    return {
      tag: this.u16(base),
      fieldType: this.u16(base + 2),
      count: this.u32(base + 4),
      valueField: base + 8,
    };
  }

  valueOffset(entry: TiffEntry): number {
    const size = typeSize(entry.fieldType);
    if (size === undefined) throw malformed('unknown TIFF field type');
    if (entry.count > 4096) throw malformed('implausible TIFF value count');
    return size * entry.count <= 4 ? entry.valueField : this.u32(entry.valueField);
  }

  rationals(offset: number, count: number): number[] {
    const values: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const base = offset + index * 8;
      const numerator = this.u32(base);
      const denominator = this.u32(base + 4);
      if (denominator === 0) throw malformed('zero denominator in a GPS rational');
      values.push(numerator / denominator);
    }
    return values;
  }

  ascii(entry: TiffEntry): string {
    if (entry.fieldType !== TYPE_ASCII) return '';
    const offset = this.valueOffset(entry);
    const slice = this.slice(offset, Math.min(entry.count, 8));
    let text = '';
    for (const byte of slice) {
      if (byte === 0) break;
      text += String.fromCharCode(byte);
    }
    return text;
  }
}

function typeSize(fieldType: number): number | undefined {
  switch (fieldType) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
    case 11:
      return 4;
    case 5:
    case 10:
    case 12:
      return 8;
    default:
      return undefined;
  }
}

function buildPlan(tiff: Tiff): Plan | undefined {
  const ifd0 = tiff.u32(4);
  const ifd0Count = tiff.ifdCount(ifd0);
  const structure = [{ start: ifd0, end: ifd0 + 2 + ifd0Count * 12 + 4 }];

  let gpsIfd: number | undefined;
  for (let index = 0; index < ifd0Count; index += 1) {
    const entry = tiff.entry(ifd0, index);
    if (entry.tag === TAG_GPS_IFD && entry.fieldType === TYPE_LONG && entry.count >= 1) {
      gpsIfd = tiff.u32(entry.valueField);
      break;
    }
  }
  if (gpsIfd === undefined) return undefined;

  const plan: Plan = { little: tiff.little, structure };
  const gpsCount = tiff.ifdCount(gpsIfd);
  structure.push({ start: gpsIfd, end: gpsIfd + 2 + gpsCount * 12 + 4 });

  for (let index = 0; index < gpsCount; index += 1) {
    const entry = tiff.entry(gpsIfd, index);
    switch (entry.tag) {
      case TAG_GPS_LATITUDE_REF:
      case TAG_GPS_LONGITUDE_REF: {
        const reference = tiff.ascii(entry).charAt(0);
        if (entry.tag === TAG_GPS_LATITUDE_REF) plan.latitudeRef = reference;
        else plan.longitudeRef = reference;
        break;
      }
      case TAG_GPS_LATITUDE:
      case TAG_GPS_LONGITUDE: {
        if (entry.fieldType !== TYPE_RATIONAL || entry.count !== 3) break;
        const offset = tiff.valueOffset(entry);
        const [degrees = 0, minutes = 0, seconds = 0] = tiff.rationals(offset, 3);
        const decimal = degrees + minutes / 60 + seconds / 3600;
        if (entry.tag === TAG_GPS_LATITUDE) {
          plan.latitude = decimal;
          plan.latitudeOffset = offset;
        } else {
          plan.longitude = decimal;
          plan.longitudeOffset = offset;
        }
        break;
      }
      case TAG_GPS_ALTITUDE_REF: {
        if (entry.count < 1) break;
        const offset = tiff.valueOffset(entry);
        plan.altitudeRef = tiff.slice(offset, 1)[0] as number;
        break;
      }
      case TAG_GPS_ALTITUDE: {
        if (entry.fieldType !== TYPE_RATIONAL || entry.count !== 1) break;
        const offset = tiff.valueOffset(entry);
        plan.altitude = tiff.rationals(offset, 1)[0] as number;
        plan.altitudeOffset = offset;
        break;
      }
      default:
        break;
    }
  }

  if (plan.latitude === undefined && plan.longitude === undefined && plan.altitude === undefined) {
    return undefined;
  }
  return plan;
}

/**
 * Redact the coordinates inside one EXIF payload.
 *
 * Accepts both the JPEG form (`Exif\0\0` + TIFF) and the raw TIFF form used by
 * PNG `eXIf` and WebP `EXIF` chunks.
 */
export function redactGpsPayload(payload: Buffer, precision: GpsPrecision): GpsRedaction | undefined {
  const gridSeconds = COORDINATE_GRID_SECONDS[precision];
  if (gridSeconds === undefined) return undefined;

  const head = payload.subarray(0, Math.min(payload.length, 6)).toString('latin1');
  let base: number;
  if (head === 'Exif\0\0') base = 6;
  else if (head.startsWith('II') || head.startsWith('MM')) base = 0;
  else return undefined;

  const plan = buildPlan(Tiff.open(payload.subarray(base)));
  if (plan === undefined) return undefined;
  refuseUnsafeWrites(plan);

  // The plan's offsets are TIFF-relative; the payload may carry an `Exif\0\0`
  // prefix, so every write lands at `base + offset`.
  if (plan.latitudeOffset !== undefined && plan.latitude !== undefined) {
    writeDms(payload, base + plan.latitudeOffset, plan.latitude, gridSeconds, plan.little);
  }
  if (plan.longitudeOffset !== undefined && plan.longitude !== undefined) {
    writeDms(payload, base + plan.longitudeOffset, plan.longitude, gridSeconds, plan.little);
  }

  let altitudeOut: number | undefined;
  if (plan.altitudeOffset !== undefined && plan.altitude !== undefined) {
    const grid = ALTITUDE_GRID_METRES[precision];
    const rounded = grid > 0 ? Math.trunc(Math.abs(plan.altitude) / grid) * grid : plan.altitude;
    // The stored value stays a magnitude; the reference tag carries the sign,
    // so only the report needs it applied.
    writeRational(payload, base + plan.altitudeOffset, rounded, 1, plan.little);
    altitudeOut = plan.altitudeRef === 1 ? -rounded : rounded;
  }

  const [latDeg, latMin, latSec]: [number, number, number] =
    plan.latitude === undefined ? [0, 0, 0] : truncateDms(plan.latitude, gridSeconds);
  const [lonDeg, lonMin, lonSec]: [number, number, number] =
    plan.longitude === undefined ? [0, 0, 0] : truncateDms(plan.longitude, gridSeconds);

  return {
    precision,
    latitude: round6(dmsToDecimal(latDeg, latMin, latSec) * sign(plan.latitudeRef, 'S')),
    longitude: round6(dmsToDecimal(lonDeg, lonMin, lonSec) * sign(plan.longitudeRef, 'W')),
    ...(altitudeOut === undefined ? {} : { altitude_metres: altitudeOut }),
  };
}

function sign(reference: string | undefined, negative: string): number {
  return reference !== undefined && reference.toUpperCase() === negative ? -1 : 1;
}

function dmsToDecimal(degrees: number, minutes: number, seconds: number): number {
  return degrees + minutes / 60 + seconds / 3600;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Truncate onto a grid so the result never moves *outside* the cell the
 * original coordinate occupied.
 *
 * Whole seconds are **rounded**, not truncated: a coordinate read back from an
 * integer DMS triple is not exact in binary floating point (`1 + 17/60 +
 * 24/3600` is a hair under 1.29), and truncating that hair lands a whole grid
 * step lower — so redacting an already-redacted file moved the coordinate
 * again. Rounding first makes the function idempotent.
 */
function truncateDms(degrees: number, gridSeconds: number): [number, number, number] {
  const seconds = Math.round(Math.abs(degrees) * 3600);
  const total = Math.trunc(seconds / gridSeconds) * gridSeconds;
  return [Math.trunc(total / 3600), Math.trunc((total % 3600) / 60), total % 60];
}

/**
 * Refuse to write where the write would destroy what the plan was built from.
 *
 * Two shapes reach this: two coordinate tags pointing at the same rational
 * array, so writing latitude overwrites the longitude just read; and a value
 * pointer aimed at the IFD entry table, so the write edits the entries that
 * describe the coordinates. Either way a second redaction reads back different
 * bytes. There is no correct value for bytes two structures share, so this
 * fails closed rather than guessing.
 */
function refuseUnsafeWrites(plan: Plan): void {
  const regions: Array<{ start: number; end: number; name: string }> = [];
  if (plan.latitudeOffset !== undefined && plan.latitude !== undefined) {
    regions.push({ start: plan.latitudeOffset, end: plan.latitudeOffset + 24, name: 'latitude' });
  }
  if (plan.longitudeOffset !== undefined && plan.longitude !== undefined) {
    regions.push({ start: plan.longitudeOffset, end: plan.longitudeOffset + 24, name: 'longitude' });
  }
  if (plan.altitudeOffset !== undefined && plan.altitude !== undefined) {
    regions.push({ start: plan.altitudeOffset, end: plan.altitudeOffset + 8, name: 'altitude' });
  }

  for (const [index, region] of regions.entries()) {
    for (const other of regions.slice(index + 1)) {
      if (region.start < other.end && other.start < region.end) {
        throw malformed(
          `the ${region.name} and ${other.name} values share bytes ` +
            `(${region.start}..${region.end} and ${other.start}..${other.end})`,
        );
      }
    }
    for (const table of plan.structure) {
      if (region.start < table.end && table.start < region.end) {
        throw malformed(
          `the ${region.name} value lies inside an IFD entry table ` +
            `(${region.start}..${region.end} in ${table.start}..${table.end})`,
        );
      }
    }
  }
}

function writeDms(payload: Buffer, offset: number, degrees: number, gridSeconds: number, little: boolean): void {
  const [d, m, s] = truncateDms(degrees, gridSeconds);
  writeRational(payload, offset, d, 1, little);
  writeRational(payload, offset + 8, m, 1, little);
  writeRational(payload, offset + 16, s, 1, little);
}

function writeRational(payload: Buffer, offset: number, numerator: number, denominator: number, little: boolean): void {
  if (offset < 0 || offset + 8 > payload.length) throw malformed('GPS rational lies outside the EXIF payload');
  if (little) {
    payload.writeUInt32LE(numerator >>> 0, offset);
    payload.writeUInt32LE(denominator >>> 0, offset + 4);
  } else {
    payload.writeUInt32BE(numerator >>> 0, offset);
    payload.writeUInt32BE(denominator >>> 0, offset + 4);
  }
}
