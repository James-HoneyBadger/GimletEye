/**
 * What a renderer may put in a tool's arguments.
 *
 * The preload's type says `string | number | boolean | null`, but a type is not
 * a check, and this process is the one that touches the filesystem: a nested
 * object reaching a tool would be coerced with `String(...)` somewhere far from
 * here, and a million keys would be accepted as readily as three. Both are
 * cheap to refuse at the boundary.
 */

import type { Args } from '@gimlet-eye/core';

/** More than any tool declares, by an order of magnitude. */
const MAX_ARGS = 64;

export function validateRunArgs(value: unknown): Args {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('args must be an object');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_ARGS) throw new Error(`args must have at most ${MAX_ARGS} keys`);

  const args: Args = {};
  for (const [key, entry] of entries) {
    if (key === '' || key.length > 64) throw new Error('argument names must be 1 to 64 characters');
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') {
      args[key] = entry;
      continue;
    }
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      args[key] = entry;
      continue;
    }
    throw new Error(`argument '${key}' must be a string, number, boolean, or null`);
  }
  return args;
}
