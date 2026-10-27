/**
 * `privacy.metadata-strip`, the one tool that rewrites a file a user cares
 * about.
 *
 * The tests are mostly about refusals, because the failures that matter here are
 * the ones that destroy something: writing over the input, replacing a file that
 * was already there, or reporting success while the metadata is still present.
 * The fixture is a real JPEG carrying EXIF GPS, so the redaction path is
 * exercised on bytes, not on a mock.
 */

import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { nodeHost } from '@gimlet-eye/core/host-node';
import { removableBytes, scan, policyAll } from '@gimlet-eye/engine';
import { defaultConfig } from '../src/config.js';
import { pathsUnder } from '../src/paths.js';
import { metadataStrip } from '../src/tools/metadata.js';
import { fakeHost, type FakeHost } from './fake-host.js';

type Store = Map<string, Buffer>;

const PHOTO = readFileSync(new URL('../../engine/test/fixtures/photo-exif-gps.jpg', import.meta.url));
const CLEAN = readFileSync(new URL('../../engine/test/fixtures/shot-plain.jpg', import.meta.url));

function host(files: Record<string, Buffer>): FakeHost & { store: Store } {
  const fake = fakeHost() as FakeHost & { store: Store };
  const store: Store = new Map(Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes)]));
  fake.store = store;
  fake.exists = async (path: string) => store.has(path);
  fake.readFile = async (path: string) => {
    const value = store.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return new Uint8Array(value);
  };
  fake.writeFile = async (path: string, bytes: Uint8Array) => store.set(path, Buffer.from(bytes));
  fake.rename = async (from: string, to: string) => {
    const value = store.get(from);
    if (value === undefined) throw new Error(`ENOENT: ${from}`);
    store.delete(from);
    store.set(to, value);
  };
  fake.removeTree = async (path: string) => {
    store.delete(path);
  };
  fake.chmodOwnerOnly = async () => undefined;
  fake.stat = async (path: string) => {
    const value = store.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return { isFile: true, isDirectory: false, size: value.length };
  };
  fake.resolve = async (path: string) => (store.has(path) ? path : path);
  return fake;
}

const ctxFor = (fake: FakeHost, dryRun = false) => ({
  host: fake,
  config: defaultConfig(),
  dryRun,
  paths: pathsUnder('/home/tester/.gimlet'),
});

describe('privacy.metadata-strip', () => {
  it('cleans to a derived name and leaves nothing removable behind', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    const report = await metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg' });

    expect((report.data as { output: string }).output).toBe('/photos/holiday.clean.jpg');
    const written = fake.store.get('/photos/holiday.clean.jpg');
    expect(written).toBeDefined();
    expect(removableBytes(scan(written!), policyAll())).toBe(0);
    expect((report.data as { removed_bytes: number }).removed_bytes).toBeGreaterThan(0);
    // The source is untouched.
    expect(fake.store.get('/photos/holiday.jpg')).toEqual(PHOTO);
  });

  it('says so when there is nothing to remove, and writes no file', async () => {
    const fake = host({ '/photos/clean.jpg': CLEAN });
    const report = await metadataStrip.run(ctxFor(fake), { input: '/photos/clean.jpg', profile: 'archive' });

    expect(report.summary).toContain('already carries no removable metadata');
    expect((report.data as { output: null }).output).toBeNull();
    expect(fake.store.has('/photos/clean.clean.jpg')).toBe(false);
  });

  it('reduces GPS precision instead of deleting EXIF', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    const report = await metadataStrip.run(ctxFor(fake), {
      input: '/photos/holiday.jpg',
      profile: 'archive',
      redact_gps: 'city',
    });

    const gps = (report.data as { gps: { precision: string; latitude: number } }).gps;
    expect(gps.precision).toBe('city');
    expect(gps.latitude).toBe(51.5);
    // EXIF survives, so the camera description is still there.
    const written = fake.store.get('/photos/holiday.clean.jpg')!;
    expect(scan(written).segments.some((segment) => segment.kind === 'APP1')).toBe(true);
    expect(removableBytes(scan(written), policyAll())).toBeGreaterThan(0);
  });

  it('warns when asked to redact GPS that is not there', async () => {
    const fake = host({ '/photos/clean.jpg': CLEAN });
    const report = await metadataStrip.run(ctxFor(fake), {
      input: '/photos/clean.jpg',
      profile: 'archive',
      redact_gps: 'city',
    });
    expect(report.warnings?.[0]).toContain('no GPS coordinates found');
  });

  it('warns that a redaction is pointless when the policy removes EXIF anyway', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    const report = await metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg', redact_gps: 'city' });
    expect(report.warnings?.some((warning) => warning.includes('gone entirely'))).toBe(true);
  });

  it('refuses an output that is the input unless in_place is given', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    await expect(
      metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg', output: '/photos/holiday.jpg' }),
    ).rejects.toThrow(/is the input file; use in_place=true/);
  });

  it('refuses in_place together with an output', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    await expect(
      metadataStrip.run(ctxFor(fake), {
        input: '/photos/holiday.jpg',
        output: '/photos/other.jpg',
        in_place: true,
      }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it('rewrites the input in place when told to', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    await metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg', in_place: true });

    const rewritten = fake.store.get('/photos/holiday.jpg')!;
    expect(removableBytes(scan(rewritten), policyAll())).toBe(0);
    // Nothing left behind by the rename dance.
    expect([...fake.store.keys()].filter((path) => path.endsWith('.tmp'))).toEqual([]);
  });

  it('will not replace an existing output without overwrite', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO, '/photos/target.jpg': CLEAN });
    await expect(
      metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg', output: '/photos/target.jpg' }),
    ).rejects.toThrow(/already exists \(use overwrite=true to replace it\)/);
    expect(fake.store.get('/photos/target.jpg')).toEqual(CLEAN);

    await metadataStrip.run(ctxFor(fake), {
      input: '/photos/holiday.jpg',
      output: '/photos/target.jpg',
      overwrite: true,
    });
    expect(fake.store.get('/photos/target.jpg')).not.toEqual(CLEAN);
  });

  it('keeps the destination\'s permissions when it rewrites one', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO, '/photos/target.jpg': CLEAN });
    fake.modes.set('/photos/target.jpg', 0o640);

    await metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg', output: '/photos/target.jpg', overwrite: true });

    // Not widened: a rewritten file must not become readable by someone who
    // could not read it before.
    expect(fake.modes.get('/photos/target.jpg')).toBe(0o640);
    expect(fake.modes.get('/photos/target.jpg.tmp')).toBe(0o640);
  });

  it('keeps a restrictive mode when it rewrites the input in place', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    fake.modes.set('/photos/holiday.jpg', 0o600);

    await metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg', in_place: true });

    expect(fake.modes.get('/photos/holiday.jpg')).toBe(0o600);
  });

  it('leaves a new file to the umask rather than forcing owner-only', async () => {
    // A cleaned photo is meant to be shared; narrowing it to 0600 would be a
    // privacy tool quietly breaking a sharing workflow.
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    fake.modes.set('/photos/holiday.jpg', 0o600);

    await metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg' });

    expect(fake.modes.has('/photos/holiday.clean.jpg')).toBe(false);
  });

  it('writes nothing on a dry run but reports what it would do', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    const report = await metadataStrip.run(ctxFor(fake, true), { input: '/photos/holiday.jpg' });

    expect(report.summary.startsWith('would clean')).toBe(true);
    expect((report.data as { output: null }).output).toBeNull();
    expect(fake.store.size).toBe(1);
  });

  it('preserves a restrictive mode through the real filesystem', async () => {
    // The fake host cannot catch a mode bug — it stubs the mode calls out — so
    // the two that matter are checked on a real file.
    const work = mkdtempSync(join(tmpdir(), 'gimlet-strip-'));
    try {
      const photo = join(work, 'photo.jpg');
      copyFileSync(new URL('../../engine/test/fixtures/photo-exif-gps.jpg', import.meta.url), photo);
      chmodSync(photo, 0o600);

      const ctx = { host: nodeHost(), config: defaultConfig(), dryRun: false, paths: pathsUnder(work) };
      await metadataStrip.run(ctx, { input: photo, in_place: true });

      expect(statSync(photo).mode & 0o777).toBe(0o600);
      expect(removableBytes(scan(readFileSync(photo)), policyAll())).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('creates a new .clean copy when there is nothing to copy a mode from', async () => {
    // `mode()` on a path that does not exist must not be an error: it is the
    // ordinary case, and getting it wrong broke creating any new copy.
    const work = mkdtempSync(join(tmpdir(), 'gimlet-strip-new-'));
    try {
      const photo = join(work, 'photo.jpg');
      copyFileSync(new URL('../../engine/test/fixtures/photo-exif-gps.jpg', import.meta.url), photo);

      const ctx = { host: nodeHost(), config: defaultConfig(), dryRun: false, paths: pathsUnder(work) };
      const report = await metadataStrip.run(ctx, { input: photo });

      const clean = join(work, 'photo.clean.jpg');
      expect(report.status).toBe('ok');
      expect(removableBytes(scan(readFileSync(clean)), policyAll())).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('reports an unknown precision as a bad argument', async () => {
    const fake = host({ '/photos/holiday.jpg': PHOTO });
    await expect(
      metadataStrip.run(ctxFor(fake), { input: '/photos/holiday.jpg', redact_gps: 'street' }),
    ).rejects.toThrow(/unknown GPS precision 'street'/);
  });

  it('rejects a file that is not there, and one that is not an image', async () => {
    const fake = host({ '/photos/notes.txt': Buffer.from('not a photo') });
    await expect(metadataStrip.run(ctxFor(fake), { input: '/photos/absent.jpg' })).rejects.toThrow(/not found/);
    await expect(metadataStrip.run(ctxFor(fake), { input: '/photos/notes.txt' })).rejects.toThrow(
      /unrecognised container/,
    );
  });
});
