import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Bounds } from './bounds.js';

/**
 * The window's last geometry, remembered as four numbers.
 *
 * Read and written in the profile directory, not `GIMLET_WORKS_HOME`: where the window
 * sat is a property of this desktop, not of the toolkit's data. A file that cannot
 * be read, or that holds something else, is treated as "no memory" rather than as
 * an error — a broken preference must never stop the app opening.
 */
export function readWindowBounds(file: string): Bounds | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((key) => value[key]);
    if ([x, y, width, height].every((number) => typeof number === 'number' && Number.isFinite(number))) {
      return { x: x as number, y: y as number, width: width as number, height: height as number };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeWindowBounds(file: string, bounds: Bounds): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(bounds));
  } catch {
    // A profile directory that cannot be written is not worth failing a window for.
  }
}
