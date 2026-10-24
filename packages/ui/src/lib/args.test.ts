import { describe, expect, it } from 'vitest';

import { toPayload, validateArgs } from './args';
import type { ToolManifest } from './api';

const tool: ToolManifest = {
  id: 'demo',
  title: 'Demo',
  summary: 'test tool',
  category: 'sysadmin',
  origin: 'builtin',
  args: [
    { name: 'input', type: 'path', required: true },
    { name: 'count', type: 'integer', default: 3 },
    { name: 'profile', type: 'enum', values: ['privacy', 'sharing'] },
    { name: 'in_place', type: 'boolean', default: false },
  ],
};

describe('validateArgs', () => {
  it('reports missing required values with a concrete message', () => {
    expect(validateArgs(tool, {})).toEqual({ input: 'Choose a file or directory' });
  });

  it('treats whitespace as empty', () => {
    expect(validateArgs(tool, { input: '   ' })).toHaveProperty('input');
  });

  it('rejects non-integer numbers', () => {
    expect(validateArgs(tool, { input: '/tmp/x', count: '1.5' })).toEqual({ count: 'Whole number expected' });
  });

  it('accepts a complete form', () => {
    expect(validateArgs(tool, { input: '/tmp/x', count: '10', profile: 'privacy', in_place: true })).toEqual({});
  });

  it('ignores optional fields left blank', () => {
    expect(validateArgs(tool, { input: '/tmp/x', count: '' })).toEqual({});
  });
});

describe('toPayload', () => {
  it('coerces integers and keeps booleans boolean', () => {
    const payload = toPayload(tool, { input: '/tmp/x', count: '7', in_place: true });
    expect(payload).toEqual({ input: '/tmp/x', count: 7, in_place: true });
  });

  it('drops empty strings so defaults apply', () => {
    expect(toPayload(tool, { input: '/tmp/x', count: '', profile: '' })).toEqual({ input: '/tmp/x' });
  });
});

describe('required booleans', () => {
  const flags: ToolManifest = {
    id: 'demo.flags',
    title: 'Flags',
    summary: 'required switch',
    category: 'sysadmin',
    origin: 'builtin',
    args: [{ name: 'confirm', type: 'boolean', required: true }],
  };

  it('accepts false as an answer rather than calling it missing', () => {
    expect(validateArgs(flags, { confirm: false })).toEqual({});
  });

  it('still reports a field that was never rendered', () => {
    expect(validateArgs(flags, {})).toHaveProperty('confirm');
  });

  it('keeps false in the payload', () => {
    expect(toPayload(flags, { confirm: false })).toEqual({ confirm: false });
  });
});
