import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readWindowBounds, writeWindowBounds } from './window-state.js';

describe('window state', () => {
  it('remembers four numbers', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gimlet-bounds-'));
    const file = join(directory, 'nested', 'window.json');
    const bounds = { x: 120, y: 80, width: 1180, height: 800 };
    writeWindowBounds(file, bounds);
    expect(readWindowBounds(file)).toEqual(bounds);
    rmSync(directory, { recursive: true, force: true });
  });

  it('treats a missing or broken file as no memory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gimlet-bounds-'));
    const file = join(directory, 'window.json');
    expect(readWindowBounds(file)).toBeNull();
    writeFileSync(file, 'not json');
    expect(readWindowBounds(file)).toBeNull();
    writeFileSync(file, '{"x": 1, "y": 2}');
    expect(readWindowBounds(file)).toBeNull();
    rmSync(directory, { recursive: true, force: true });
  });
});
