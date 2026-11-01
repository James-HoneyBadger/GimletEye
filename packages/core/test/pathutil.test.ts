import { describe, expect, it } from 'vitest';

import { isWithin } from '../src/pathutil.js';

describe('isWithin', () => {
  it('accepts the root itself and anything under it', () => {
    expect(isWithin('/home/u/.config/gimlet', '/home/u/.config/gimlet')).toBe(true);
    expect(isWithin('/home/u/.config/gimlet', '/home/u/.config/gimlet/data/keys')).toBe(true);
    expect(isWithin('/home/u/.config/gimlet/', '/home/u/.config/gimlet/audit.jsonl')).toBe(true);
  });

  it('refuses a sibling that starts with the same characters', () => {
    expect(isWithin('/data', '/data-old/audit.jsonl')).toBe(false);
    expect(isWithin('/home/u/.config/gimlet', '/home/u/.config/gimlet-other')).toBe(false);
  });

  it('refuses a path that climbs out', () => {
    expect(isWithin('/home/u/.config/gimlet', '/home/u/.config/gimlet/../../secrets')).toBe(false);
  });

  it('normalises both sides before comparing', () => {
    expect(isWithin('/home/u/./.config/gimlet', '/home/u/.config/gimlet/data')).toBe(true);
    expect(isWithin('/home/u/.config/gimlet', '/home/u/.config/gimlet/data/../data/x')).toBe(true);
  });

  it('refuses a parent', () => {
    expect(isWithin('/home/u/.config/gimlet/data', '/home/u/.config/gimlet')).toBe(false);
  });
});
