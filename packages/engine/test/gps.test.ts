/**
 * GPS redaction, checked against the values the Rust implementation produced.
 *
 * The expectations here were not invented for this port: they are the numbers
 * `crates/scrub/src/exif.rs` asserts, so a mismatch means the behaviour moved.
 * The two hostile fixtures are the cases a fuzzer found — shared rationals and a
 * value pointer aimed at the entry table — and they must fail closed rather than
 * move a coordinate on every run.
 */

import { describe, expect, it } from 'vitest';

import {
  parseGpsPrecision,
  redactGps,
  redactGpsPayload,
  type GpsPrecision,
} from '../src/scrub/gps.js';

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

type Dms = [number, number, number];

/**
 * The Rust fixture builder, byte for byte: a big-endian EXIF block with a GPS
 * pointer in IFD0 and refs, latitude, longitude, and altitude in the GPS IFD.
 */
function buildExif(
  lat: Dms,
  lon: Dms,
  altitude: number | undefined,
  latRef: string,
  lonRef: string,
  altitudeRef?: number,
): Buffer {
  const entries = altitudeRef === undefined ? 5 : 6;
  const parts: Buffer[] = [];
  const u16 = (value: number) => {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(value);
    return buffer;
  };
  const u32 = (value: number) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value);
    return buffer;
  };

  const gpsOffset = 26;
  const dataStart = 26 + 2 + entries * 12 + 4;

  parts.push(Buffer.from('MM', 'latin1'), u16(42), u32(8));
  // IFD0: one entry, the GPS IFD pointer, then the next-IFD offset.
  parts.push(u16(1), u16(TAG_GPS_IFD), u16(TYPE_LONG), u32(1), u32(gpsOffset), u32(0));

  parts.push(u16(entries));
  parts.push(u16(TAG_GPS_LATITUDE_REF), u16(TYPE_ASCII), u32(2), Buffer.from([latRef.charCodeAt(0), 0, 0, 0]));
  parts.push(u16(TAG_GPS_LATITUDE), u16(TYPE_RATIONAL), u32(3), u32(dataStart));
  parts.push(u16(TAG_GPS_LONGITUDE_REF), u16(TYPE_ASCII), u32(2), Buffer.from([lonRef.charCodeAt(0), 0, 0, 0]));
  parts.push(u16(TAG_GPS_LONGITUDE), u16(TYPE_RATIONAL), u32(3), u32(dataStart + 24));
  if (altitudeRef !== undefined) {
    parts.push(u16(TAG_GPS_ALTITUDE_REF), u16(1), u32(1), Buffer.from([altitudeRef, 0, 0, 0]));
  }
  parts.push(u16(TAG_GPS_ALTITUDE), u16(TYPE_RATIONAL), u32(1), u32(dataStart + 48));
  parts.push(u32(0));

  for (const part of [...lat, ...lon]) {
    parts.push(u32(part * 1_000_000), u32(1_000_000));
  }
  parts.push(u32(altitude ?? 0), u32(1));

  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), ...parts]);
}

/** The three rationals of a coordinate, as they sit on disk. */
function readDms(payload: Buffer, base: number, offset: number): Dms {
  const values: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const at = base + offset + index * 8;
    values.push(payload.readUInt32BE(at) / payload.readUInt32BE(at + 4));
  }
  return values as Dms;
}

const LONDON: Dms = [51, 30, 26.46];
const GREENWICH: Dms = [0, 7, 39.93];

describe('GPS redaction', () => {
  it('truncates to two decimals at city precision', () => {
    const payload = buildExif(LONDON, GREENWICH, 35, 'N', 'W');
    const redaction = redactGpsPayload(payload, 'city');
    expect(redaction).toBeDefined();
    expect(redaction!.precision).toBe('city');
    expect(redaction!.latitude).toBe(51.5);
    expect(redaction!.longitude).toBe(-0.12);
    expect(redaction!.altitude_metres).toBe(30);
    // The rewritten coordinates, not just the report: 51° 30' 0".
    expect(readDms(payload, 6, 92)).toEqual([51, 30, 0]);
  });

  it('reports a below-sea-level altitude as negative but stores the magnitude', () => {
    const payload = buildExif(LONDON, GREENWICH, 35, 'N', 'W', 1);
    expect(redactGpsPayload(payload, 'city')!.altitude_metres).toBe(-30);
    const altitudeEntry = 6 + (26 + 2 + 6 * 12 + 4) + 48;
    expect(payload.readUInt32BE(altitudeEntry)).toBe(30);
  });

  it('is coarser at region and country', () => {
    expect(redactGpsPayload(buildExif(LONDON, GREENWICH, undefined, 'N', 'W'), 'region')).toMatchObject({
      latitude: 51.5,
      longitude: -0.1,
    });
    // A western reference with no whole-degree component rounds to -0, which is
    // 0 in every sense that matters; `toBeCloseTo` says so without pretending
    // the sign is absent.
    const country = redactGpsPayload(buildExif(LONDON, GREENWICH, undefined, 'N', 'W'), 'country')!;
    expect(country.latitude).toBe(51);
    expect(country.longitude).toBeCloseTo(0);
  });

  it('turns southern and western references negative, easterly positive', () => {
    const redaction = redactGpsPayload(buildExif([33, 51, 0], [151, 12, 0], undefined, 'S', 'E'), 'country');
    expect(redaction!.latitude).toBe(-33);
    expect(redaction!.longitude).toBe(151);
  });

  it('is a fixed point for a coordinate already on the grid', () => {
    // 1° 17' 24" is 4644 seconds — exactly 129 city steps — but it reads back
    // from binary floating point as 4643.999…, so truncating before snapping
    // lands a whole step lower and silently coarsens a file that was already
    // coarse enough. That is the bug the Rust fuzz target found, and a second
    // pass alone does not catch it: 1.28° happens to truncate to itself.
    const payload = buildExif([1, 17, 24], [0, 7, 39.93], undefined, 'N', 'E');
    const redaction = redactGpsPayload(payload, 'city')!;

    expect(redaction.latitude).toBe((129 * 36) / 3600);
    expect(readDms(payload, 6, 92)).toEqual([1, 17, 24]);
  });

  it('redacts idempotently', () => {
    const payload = buildExif(LONDON, GREENWICH, undefined, 'N', 'W');
    const first = redactGpsPayload(payload, 'city');
    const afterFirst = Buffer.from(payload);
    const second = redactGpsPayload(payload, 'city');
    expect(second).toEqual(first);
    // Same report *and* same bytes: the second pass is a no-op, not another step.
    expect(payload.equals(afterFirst)).toBe(true);
    expect(readDms(payload, 6, 92)).toEqual([51, 30, 0]);
  });

  it('accepts the raw TIFF form that PNG and WebP chunks use', () => {
    const payload = buildExif(LONDON, GREENWICH, undefined, 'N', 'W').subarray(6);
    expect(redactGpsPayload(payload, 'country')!.latitude).toBe(51);
  });

  it('does nothing at off precision', () => {
    const payload = buildExif([51, 30, 0], [0, 7, 0], undefined, 'N', 'W');
    const original = Buffer.from(payload);
    expect(redactGpsPayload(payload, 'off')).toBeUndefined();
    expect(payload.equals(original)).toBe(true);
  });

  it('returns nothing when the block carries no coordinates', () => {
    const empty = Buffer.concat([
      Buffer.from('MM', 'latin1'),
      Buffer.from([0, 42]),
      Buffer.from([0, 0, 0, 8]),
      Buffer.from([0, 0]),
      Buffer.from([0, 0, 0, 0]),
    ]);
    expect(redactGpsPayload(empty, 'city')).toBeUndefined();
  });

  it('rejects a malformed structure instead of guessing', () => {
    const truncated = Buffer.from('Exif\0\0MM\x00\x2a\x00\x00\x00\x08\x00\x01', 'latin1');
    expect(() => redactGpsPayload(truncated, 'city')).toThrow(/cannot redact GPS/);
  });

  it('refuses coordinates that share bytes', () => {
    // Both tags point at the same rational array: writing one rewrites the other.
    const payload = buildExif(LONDON, GREENWICH, undefined, 'N', 'W');
    const longitudeOffsetAt = 6 + 26 + 2 + 3 * 12 + 8;
    payload.writeUInt32BE(92, longitudeOffsetAt);
    expect(() => redactGpsPayload(payload, 'city')).toThrow(/share bytes/);
  });

  it('refuses a value pointer aimed at the entry table', () => {
    const payload = buildExif(LONDON, GREENWICH, undefined, 'N', 'W');
    const latitudeOffsetAt = 6 + 26 + 2 + 1 * 12 + 8;
    payload.writeUInt32BE(26, latitudeOffsetAt); // inside the GPS IFD itself
    expect(() => redactGpsPayload(payload, 'city')).toThrow(/inside an IFD entry table/);
  });

  it('parses the precision names the argument accepts', () => {
    expect(parseGpsPrecision('City')).toBe('city');
    expect(parseGpsPrecision('off')).toBe('off');
    expect(parseGpsPrecision('none')).toBe('off');
    expect(parseGpsPrecision('')).toBe('off');
    expect(() => parseGpsPrecision('block')).toThrow(/unknown GPS precision 'block'/);
  });

  it('redacts every EXIF block in a container', () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      app1(buildExif(LONDON, GREENWICH, undefined, 'N', 'W')),
      app1(buildExif([1, 17, 24], [2, 20, 0], undefined, 'N', 'E')),
      Buffer.from([0xff, 0xd9]),
    ]);
    const redaction = redactGps(jpeg, 'country');
    expect(redaction).toBeDefined();
    expect(redaction!.latitude).toBe(1); // the last block's answer
    // Both blocks were rewritten.
    const first = jpeg.indexOf(Buffer.from('MM', 'latin1'));
    expect(readDms(jpeg, first, 92)).toEqual([51, 0, 0]);
  });
});

function app1(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8(0xff, 0);
  header.writeUInt8(0xe1, 1);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const PRECISIONS: GpsPrecision[] = ['country', 'region', 'city'];

/** One cell of the grid, in degrees: 3600, 360, and 36 seconds of arc. */
const CELL_DEGREES: Record<Exclude<GpsPrecision, 'off'>, number> = { country: 1, region: 0.1, city: 0.01 };

describe('the precision grid', () => {
  it('moves a coordinate into its own cell, never past it', () => {
    for (const precision of PRECISIONS) {
      const cell = CELL_DEGREES[precision];
      const payload = buildExif(LONDON, GREENWICH, undefined, 'N', 'W');
      const redaction = redactGpsPayload(payload, precision)!;

      // Truncation only ever decreases, so the upper bound alone would hold for
      // any answer. The lower bound is the one that says "in the same cell":
      // 51.50735 may become 51.5 but not 51.0.
      expect(redaction.latitude, precision).toBeLessThanOrEqual(51.50735);
      expect(redaction.latitude, precision).toBeGreaterThan(51.50735 - cell);
      expect(Math.abs(redaction.longitude), precision).toBeLessThanOrEqual(0.12776);
      expect(Math.abs(redaction.longitude), precision).toBeGreaterThan(0.12776 - cell);

      // And it lands exactly on the grid, which is what makes a second pass a
      // no-op instead of another step.
      for (const value of [redaction.latitude, redaction.longitude]) {
        const seconds = Math.round(Math.abs(value) * 3600);
        expect(seconds % Math.round(cell * 3600), `${precision} ${value}`).toBe(0);
      }
    }
  });
});

/**
 * The expected answer, computed from the definitions rather than from the code.
 *
 * One sample coordinate is not enough: `redact_gps=city` on London happens to
 * land on the same value whether it snaps on a 36-second or a 108-second grid,
 * so a longitude-only bug in the grid was invisible. This checks every
 * combination below against the arithmetic instead.
 */
function snap(degrees: number, gridSeconds: number): number {
  const seconds = Math.round(Math.abs(degrees) * 3600);
  return (Math.trunc(seconds / gridSeconds) * gridSeconds) / 3600;
}

describe('the grid arithmetic, over many coordinates', () => {
  const DEGREES = [0, 1, 12, 33, 51, 89];
  const MINUTES = [0, 7, 30, 59];
  const SECONDS = [0, 0.5, 26.46, 59.99];

  it('snaps both axes onto the grid, at every precision', () => {
    for (const precision of PRECISIONS) {
      const grid = CELL_DEGREES[precision] * 3600;
      for (const degrees of DEGREES) {
        for (const minutes of MINUTES) {
          for (const seconds of SECONDS) {
            // Longitude deliberately different from latitude, so a bug in one
            // axis cannot hide behind the other.
            const lonDegrees = 89 - degrees;
            const lonMinutes = 59 - minutes;
            const lonSeconds = seconds === 0 ? 0.5 : seconds;

            const payload = buildExif(
              [degrees, minutes, seconds],
              [lonDegrees, lonMinutes, lonSeconds],
              undefined,
              'N',
              'W',
            );
            const redaction = redactGpsPayload(payload, precision)!;
            const lat = degrees + minutes / 60 + seconds / 3600;
            const lon = lonDegrees + lonMinutes / 60 + lonSeconds / 3600;

            expect(redaction.latitude, `${precision} ${lat}`).toBe(snap(lat, grid));
            // A western reference, so the magnitude is what the grid decides.
            expect(redaction.longitude, `${precision} -${lon}`).toBe(-snap(lon, grid));

            // The report is not the deliverable — the bytes on disk are. A bug
            // that writes one axis wrong and reports it right passed every test
            // here until these two lines existed, and that is the same shape as
            // the base-offset bug this port shipped with. Offsets 92 and 116 are
            // the two coordinate arrays in a five-entry GPS IFD; the sign lives
            // in the reference tags, so only magnitudes are compared.
            // Compared in whole seconds: the file stores integer DMS, so
            // converting back to degrees carries rounding of its own.
            const [latD, latM, latS] = readDms(payload, 6, 92);
            const [lonD, lonM, lonS] = readDms(payload, 6, 116);
            expect(latD * 3600 + latM * 60 + latS, `${precision} lat on disk`).toBe(
              Math.round(snap(lat, grid) * 3600),
            );
            expect(lonD * 3600 + lonM * 60 + lonS, `${precision} lon on disk`).toBe(
              Math.round(snap(lon, grid) * 3600),
            );
          }
        }
      }
    }
  });
});
