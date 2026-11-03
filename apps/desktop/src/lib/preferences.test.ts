import { describe, expect, it } from 'vitest';

import { LEGACY_PREFERENCES_KEYS, PREFERENCES_KEY, readPreferences } from './preferences';

const storage = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null,
});

describe('preference migration', () => {
  it('reads the new key before the old keys', () => {
    expect(
      readPreferences(
        storage({
          [PREFERENCES_KEY]: '{"theme":"light"}',
          [LEGACY_PREFERENCES_KEYS[0]]: '{"theme":"dark"}',
        }),
      ),
    ).toEqual({ theme: 'light' });
  });

  it('reads either previous key when the new key is absent', () => {
    for (const key of LEGACY_PREFERENCES_KEYS) {
      expect(readPreferences(storage({ [key]: '{"theme":"dark","pins":["demo"]}' }))).toEqual({
        theme: 'dark',
        pins: ['demo'],
      });
    }
  });
});
