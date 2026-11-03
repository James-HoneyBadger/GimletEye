import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { desktopProfilePath } from './profile.js';

describe('desktop profile migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'gimlet-works-profile-'));
  const current = join(root, 'Gimlet Works');
  const legacy = join(root, 'Gimlet Eye');
  const scopedCurrent = join(root, '@gimlet-works', 'desktop');
  const scopedLegacy = join(root, '@gimlet-eye', 'desktop');

  afterEach(() => {
    rmSync(current, { recursive: true, force: true });
    rmSync(legacy, { recursive: true, force: true });
    rmSync(scopedCurrent, { recursive: true, force: true });
    rmSync(scopedLegacy, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses the new profile for a fresh installation', () => {
    expect(desktopProfilePath(current, root)).toBe(current);
    expect(desktopProfilePath(scopedCurrent, root)).toBe(scopedCurrent);
  });

  it('reuses the old profile until the new one contains saved app state', () => {
    mkdirSync(legacy);
    expect(desktopProfilePath(current, root)).toBe(legacy);
    mkdirSync(current);
    mkdirSync(join(current, 'Crashpad'));
    expect(desktopProfilePath(current, root)).toBe(legacy);
    writeFileSync(join(current, 'window.json'), '{}');
    expect(desktopProfilePath(current, root)).toBe(current);
  });

  it('prefers the scoped profile used by old development and packaged builds', () => {
    mkdirSync(legacy);
    mkdirSync(scopedLegacy, { recursive: true });
    expect(desktopProfilePath(scopedCurrent, root)).toBe(scopedLegacy);
    expect(desktopProfilePath(current, root)).toBe(scopedLegacy);
    mkdirSync(scopedCurrent, { recursive: true });
    mkdirSync(join(scopedCurrent, 'Local Storage'));
    expect(desktopProfilePath(scopedCurrent, root)).toBe(scopedCurrent);
  });

  it('does not silently ignore an invalid profile path', () => {
    writeFileSync(legacy, 'not a directory');
    expect(() => desktopProfilePath(current, root)).toThrow(/not a directory/);
  });
});
