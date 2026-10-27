import { describe, expect, it } from 'vitest';

import { strip, policyProfile } from '@gimlet-eye/engine';

import { defaultConfig } from '../src/config.js';
import { sha256 } from '../src/tools/hash.js';
import { metadataScan, metadataVerify } from '../src/tools/metadata.js';
import { passgen } from '../src/tools/passwords.js';
import { fakeHost, type FakeHost } from './fake-host.js';

/** A host whose binary reads are real bytes, which the text-backed fake cannot do. */
function binaryHost(bytes: Buffer): FakeHost {
  const host = fakeHost();
  host.exists = async (path: string) => path === '/tmp/photo.jpg';
  host.readFile = async () => new Uint8Array(bytes);
  return host;
}

const ctxFor = (host: FakeHost) => ({ host, config: defaultConfig(), dryRun: false });

/** SOI, APP1/EXIF, COM, SOS — the shape the JPEG walker classifies. */
function sampleJpeg(): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  const segment = (marker: number, payload: Buffer): void => {
    const header = Buffer.alloc(4);
    header[0] = 0xff;
    header[1] = marker;
    header.writeUInt16BE(payload.length + 2, 2);
    parts.push(header, payload);
  };
  segment(0xe1, Buffer.from('Exif\u0000\u0000FAKE-EXIF-PAYLOAD', 'latin1'));
  segment(0xfe, Buffer.from('shot on a phone', 'latin1'));
  // SOS plus entropy data and EOI, which the walker treats as one structural tail.
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
  parts.push(Buffer.from([0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]));
  return Buffer.concat(parts);
}

describe('crypto.sha256, in process', () => {
  it('hashes text to the published vector', async () => {
    const host = fakeHost();
    const report = await sha256.run(ctxFor(host), { text: 'abc' });
    expect((report.data as { sha256: string }).sha256).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(report.summary).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect((report.data as { source: string }).source).toBe('text');
  });

  it('hashes a file and reports its size', async () => {
    const host = binaryHost(Buffer.from('hello'));
    host.exists = async (path: string) => path === '/tmp/hello.txt';
    const report = await sha256.run(ctxFor(host), { path: '/tmp/hello.txt' });
    const data = report.data as { sha256: string; size_bytes: number; source: string };
    expect(data.size_bytes).toBe(5);
    expect(data.source).toBe('/tmp/hello.txt');
    expect(data.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('requires exactly one input', async () => {
    await expect(sha256.run(ctxFor(fakeHost()), {})).rejects.toThrow(/one of 'path' or 'text'/);
    await expect(sha256.run(ctxFor(fakeHost()), { path: '/x', text: 'abc' })).rejects.toThrow(/not both/);
  });

  it('says a missing file is missing', async () => {
    await expect(sha256.run(ctxFor(fakeHost()), { path: '/nope' })).rejects.toThrow(/not found/);
  });
});

describe('crypto.passgen, in process', () => {
  it('honours the defaults and reports the budget', async () => {
    const report = await passgen.run(ctxFor(fakeHost()), {});
    const data = report.data as { passwords: string[]; length: number; entropy_bits: number };
    expect(data.passwords).toHaveLength(1);
    expect(data.passwords[0]).toHaveLength(24);
    expect(data.entropy_bits).toBeGreaterThan(60);
    expect(report.findings ?? []).toEqual([]);
  });

  it('flags a password that is too short to store', async () => {
    const report = await passgen.run(ctxFor(fakeHost()), { length: 8, count: 2 });
    expect(report.status).toBe('warning');
    expect(report.findings?.[0]?.code).toBe('passgen.low_entropy');
    expect((report.data as { passwords: string[] }).passwords).toHaveLength(2);
  });

  it('refuses a length outside the range', async () => {
    await expect(passgen.run(ctxFor(fakeHost()), { length: 4 })).rejects.toThrow(/between 8 and 256/);
  });
});

describe('privacy.metadata-scan, in process', () => {
  it('describes the segments and what the policy would remove', async () => {
    const jpeg = sampleJpeg();
    const report = await metadataScan.run(ctxFor(binaryHost(jpeg)), { input: '/tmp/photo.jpg' });

    const data = report.data as {
      format: string;
      size_bytes: number;
      metadata_bytes: number;
      removable_bytes: number;
      segments: { kind: string; category: string }[];
    };
    expect(data.format).toBe('jpeg');
    expect(data.size_bytes).toBe(jpeg.length);
    expect(data.removable_bytes).toBe(data.metadata_bytes);
    expect(data.segments.map((segment) => segment.kind)).toEqual(['APP1', 'COM', 'SOS']);
    expect(data.segments.map((segment) => segment.category)).toEqual(['identity', 'text', 'structural']);

    expect(report.findings?.[0]?.code).toBe('metadata.present');
    expect(report.findings?.[0]?.severity).toBe('medium');
  });

  it('honours the profile and the overrides', async () => {
    const jpeg = sampleJpeg();
    const archive = await metadataScan.run(ctxFor(binaryHost(jpeg)), { input: '/tmp/photo.jpg', profile: 'archive' });
    expect((archive.data as { removable_bytes: number }).removable_bytes).toBe(0);
    expect(archive.findings ?? []).toEqual([]);

    // Keeping EXIF still leaves the comment removable, so the verdict is a
    // warning — and the finding must name only what is actually still there.
    const kept = await metadataScan.run(ctxFor(binaryHost(jpeg)), { input: '/tmp/photo.jpg', keep: 'EXIF' });
    expect(kept.status).toBe('warning');
    const message = kept.findings?.[0]?.message ?? '';
    expect(message).toContain('Comment');
    expect(message).not.toContain('EXIF');
  });

  it('refuses a profile it does not have', async () => {
    await expect(
      metadataScan.run(ctxFor(binaryHost(sampleJpeg())), { input: '/tmp/photo.jpg', profile: 'paranoid' }),
    ).rejects.toThrow(/unknown profile/);
  });
});

describe('privacy.metadata-verify, in process', () => {
  it('fails a file that still carries metadata', async () => {
    const jpeg = sampleJpeg();
    const report = await metadataVerify.run(ctxFor(binaryHost(jpeg)), { input: '/tmp/photo.jpg' });
    expect(report.status).toBe('error');
    expect(report.findings?.[0]?.code).toBe('metadata.remaining');
    expect(report.findings?.[0]?.severity).toBe('high');
  });

  it('passes a file the stripper has cleaned', async () => {
    const clean = strip(sampleJpeg(), policyProfile('privacy'));
    const report = await metadataVerify.run(ctxFor(binaryHost(clean)), { input: '/tmp/photo.jpg' });
    expect(report.status).toBe('ok');
    expect(report.findings ?? []).toEqual([]);
    expect(report.summary).toContain('is clean under');
  });
});
