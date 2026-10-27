import { describe, expect, it } from 'vitest';

import { validateRunArgs } from './validate.js';

describe('what a renderer may pass as tool arguments', () => {
  it('accepts the primitives the bridge declares', () => {
    expect(validateRunArgs({ text: 'hello', length: 32, upper: true, nothing: null })).toEqual({
      text: 'hello',
      length: 32,
      upper: true,
      nothing: null,
    });
  });

  it('refuses a nested object, which would be coerced somewhere far away', () => {
    expect(() => validateRunArgs({ to: { evil: true } })).toThrow(/must be a string, number, boolean, or null/);
    expect(() => validateRunArgs({ to: ['a'] })).toThrow(/must be a string/);
  });

  it('refuses numbers that are not finite', () => {
    expect(() => validateRunArgs({ length: Number.NaN })).toThrow(/must be a string/);
    expect(() => validateRunArgs({ length: Number.POSITIVE_INFINITY })).toThrow(/must be a string/);
  });

  it('refuses far more arguments than any tool declares', () => {
    const many = Object.fromEntries(Array.from({ length: 65 }, (_unused, index) => [`k${index}`, 'v']));
    expect(() => validateRunArgs(many)).toThrow(/at most 64 keys/);
  });

  it('refuses a container that is not an object of arguments', () => {
    expect(() => validateRunArgs(null)).toThrow(/args must be an object/);
    expect(() => validateRunArgs(['text=hello'])).toThrow(/args must be an object/);
    expect(() => validateRunArgs('text=hello')).toThrow(/args must be an object/);
  });
});
