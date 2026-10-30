/**
 * The argument gate.
 *
 * It exists so that a name a tool does not declare, a missing required value, or
 * an enum value outside its list is a usage error — not a silently ignored typo
 * on a tool that writes files.
 */

import { describe, expect, it } from 'vitest';

import { argProblems, validateRun } from '../src/validate.js';
import type { ToolManifest } from '../src/manifest.js';

const manifest: ToolManifest = {
  id: 'demo.args',
  title: 'Demo',
  summary: 'demo',
  category: 'privacy',
  args: [
    { name: 'input', type: 'path', required: true },
    { name: 'profile', type: 'enum', values: ['privacy', 'archive'], default: 'privacy' },
    { name: 'length', type: 'integer' },
    { name: 'overwrite', type: 'boolean' },
    { name: 'label', type: 'string' },
  ],
};

describe('the argument gate', () => {
  it('accepts a well-formed bag, including a text boolean and a digit string', () => {
    expect(argProblems(manifest, { input: '/a.jpg', profile: 'archive', length: '32', overwrite: 'yes' })).toEqual(
      [],
    );
  });

  it('accepts an optional argument that was not supplied', () => {
    expect(argProblems(manifest, { input: '/a.jpg' })).toEqual([]);
  });

  it('names every problem at once, in a stable order', () => {
    expect(argProblems(manifest, { profile: 'nope', length: -1, bogus: 'x' })).toEqual([
      "unknown argument 'bogus'",
      "missing required argument 'input'",
      "argument 'profile' must be one of: privacy, archive",
      "argument 'length' must be a non-negative integer",
    ]);
  });

  it('treats an empty string as missing, because a form leaves it that way', () => {
    expect(argProblems(manifest, { input: '' })).toEqual(["missing required argument 'input'"]);
  });

  it('refuses an integer string it cannot represent exactly', () => {
    expect(argProblems(manifest, { input: '/a.jpg', length: '9007199254740993' })).toEqual([
      "argument 'length' must be a non-negative integer",
    ]);
  });

  it('throws a usage error rather than returning the list', () => {
    expect(() => validateRun(manifest, { input: '/a.jpg', bogus: 1 })).toThrow(/unknown argument 'bogus'/);
  });
});
