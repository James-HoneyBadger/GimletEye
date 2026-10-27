import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  metadataLabels,
  policyProfile,
  policyNone,
  removableBytes,
  scan,
  sha256Hex,
  strip,
  withOverrides,
} from '../src/index.js';

interface ExpectedProfile {
  removed_bytes: number;
  stripped_bytes: number;
  stripped_sha256: string;
}
interface ExpectedFixture {
  file: string;
  format: string;
  metadata_bytes: number;
  segments: { kind: string; category: string; size: number }[];
  profiles: Record<string, ExpectedProfile>;
}

const expected = JSON.parse(
  readFileSync(new URL('./fixtures/golden-expected.json', import.meta.url), 'utf8'),
) as { fixtures: ExpectedFixture[] };

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

/**
 * The corpus is the contract: these hashes were produced by the Rust scrubber.
 * Matching them means this implementation makes the same decisions *and* writes
 * the same bytes, which a round trip would not prove.
 */
describe('the golden corpus', () => {
  for (const entry of expected.fixtures) {
    describe(entry.file, () => {
      const bytes = fixture(entry.file);

      it('scans to the same segments', () => {
        const result = scan(bytes);
        expect(result.format).toBe(entry.format);
        expect(result.metadata_bytes).toBe(entry.metadata_bytes);
        expect(result.segments.map((segment) => ({
          kind: segment.kind,
          category: segment.category,
          size: segment.size,
        }))).toEqual(entry.segments);
      });

      for (const [profile, want] of Object.entries(entry.profiles)) {
        it(`strips with the ${profile} profile to the recorded bytes`, () => {
          const policy = policyProfile(profile);
          expect(removableBytes(scan(bytes), policy)).toBe(want.removed_bytes);

          const out = strip(bytes, policy);
          expect(out.length).toBe(want.stripped_bytes);
          expect(sha256Hex(out)).toBe(want.stripped_sha256);
        });
      }

      it('never grows a file and never needs a second strip', () => {
        for (const profile of Object.keys(entry.profiles)) {
          const policy = policyProfile(profile);
          const once = strip(bytes, policy);
          const twice = strip(once, policy);
          expect(once.length).toBeLessThanOrEqual(bytes.length);
          expect(twice.equals(once)).toBe(true);
        }
        // Only a full strip is expected to leave nothing behind; `sharing`
        // keeps timestamps and `archive` keeps everything on purpose.
        expect(removableBytes(scan(strip(bytes, policyProfile('privacy'))), policyProfile('privacy'))).toBe(0);
      });
    });
  }

  it('keeps the archive profile byte-identical to the input', () => {
    for (const entry of expected.fixtures) {
      const bytes = fixture(entry.file);
      const kept = strip(bytes, policyNone());
      expect(kept.equals(bytes)).toBe(true);
      expect(sha256Hex(kept)).toBe(sha256Hex(bytes));
    }
  });
});

describe('policies', () => {
  const gps = fixture('photo-gps.jpg');

  it('keeps what it is told to keep, even against a broad profile', () => {
    const kept = strip(gps, withOverrides(policyProfile('privacy'), undefined, 'EXIF'));
    const labels = metadataLabels(scan(kept));
    expect(labels).toContain('EXIF (including GPS)');
    expect(labels).not.toContain('Comment');
  });

  it('removes what it is told to remove, by kind or label prefix', () => {
    const byKind = strip(gps, withOverrides(policyNone(), 'COM'));
    expect(metadataLabels(scan(byKind))).not.toContain('Comment');

    const byLabel = strip(gps, withOverrides(policyNone(), 'EXIF'));
    expect(metadataLabels(scan(byLabel))).not.toContain('EXIF (including GPS)');
  });

  it('refuses a profile it does not have', () => {
    expect(() => policyProfile('paranoid')).toThrow(/unknown profile/);
  });

  it('leaves structure and colour alone whatever the profile', () => {
    const keepable = (bytes: Buffer): string[] =>
      scan(bytes)
        .segments.filter((segment) => segment.category === 'structural' || segment.category === 'color')
        .map((segment) => segment.kind);

    for (const entry of expected.fixtures) {
      const bytes = fixture(entry.file);
      for (const profile of ['privacy', 'sharing']) {
        const out = strip(bytes, policyProfile(profile));
        const categories = scan(out).segments.map((segment) => segment.category);
        expect(categories).not.toContain('identity');
        expect(categories).not.toContain('text');
        // Every structural and colour region survives, in order.
        expect(keepable(out)).toEqual(keepable(bytes));
      }
    }
  });
});

describe('hostile input', () => {
  it('names the formats it supports instead of guessing', () => {
    expect(() => scan(Buffer.from('GIF89a-not-really'))).toThrow(/unrecognised container.*JPEG, PNG, and WebP/s);
  });

  it('rejects a blob that claims to be a JPEG but is not one', () => {
    expect(() => scan(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]))).toThrow(/malformed|truncated/);
  });

  it('rejects a PNG with a chunk that runs past the end', () => {
    const bytes = Buffer.from(fixture('scan-clean.png'));
    bytes.writeUInt32BE(0xffff_ffff, 8);
    expect(() => scan(bytes)).toThrow(/truncated 'IHDR'/);
  });

  it('rejects a WebP chunk that runs past the end', () => {
    const bytes = Buffer.from(fixture('shot-extended.webp'));
    bytes.writeUInt32LE(0xffff_ffff, 16);
    expect(() => scan(bytes)).toThrow(/truncated/);
  });

  it('advances past the shortest legal segment instead of looping', () => {
    // APP0 with the minimum length (2) carries no payload; the walker must move
    // on to the EOI rather than reading a zero-length body forever.
    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
    expect(scan(tiny).segments).toEqual([
      { kind: 'APP0', label: 'APP0', category: 'structural', offset: 2, size: 4 },
    ]);
  });
});
