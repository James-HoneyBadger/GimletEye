/**
 * The `Report.data` contract.
 *
 * Gate 3 asks that a consumer can parse a report without reverse-engineering it.
 * Schema validation is only worth having if it runs where reports are produced
 * and if the schemas match reality, so this covers three things: the checker
 * itself, the runtime choke point every surface goes through, and the fact that
 * every shipped tool declares a shape at all.
 */

import { describe, expect, it } from 'vitest';

import { assertDataShape, dataProblems, kindOf } from '../src/data-schema.js';
import { NODE_TOOLS } from '../src/node.js';
import { Runtime } from '../src/runtime.js';
import { fakeHost } from './fake-host.js';
import type { LocalTool } from '../src/local.js';
import type { DataFieldSpec, ToolManifest } from '../src/manifest.js';

const manifest = (data?: ToolManifest['data']): ToolManifest => ({
  id: 'demo.shape',
  title: 'Demo',
  summary: 'A tool that exists to have a shape',
  category: 'sysadmin',
  ...(data === undefined ? {} : { data }),
});

describe('reading a value as a schema kind', () => {
  it('names every kind a report can carry', () => {
    expect(kindOf('x')).toBe('string');
    expect(kindOf(1)).toBe('number');
    expect(kindOf(true)).toBe('boolean');
    expect(kindOf(null)).toBe('null');
    expect(kindOf([])).toBe('array');
    expect(kindOf({})).toBe('object');
    expect(kindOf(undefined)).toBe('unknown');
  });
});

describe('checking data against its schema', () => {
  const spec = {
    shape: 'object' as const,
    required: { input: 'string' as const, bytes: 'number' as const, output: 'string|null' as const },
  };

  it('accepts a report that matches, including a union', () => {
    expect(dataProblems(manifest(spec), { input: 'a', bytes: 1, output: null })).toEqual([]);
    expect(dataProblems(manifest(spec), { input: 'a', bytes: 1, output: 'b' })).toEqual([]);
  });

  it('names the field, what it wanted, and what it got', () => {
    const problems = dataProblems(manifest(spec), { input: 'a', bytes: 'one', output: 'b' });
    expect(problems).toEqual(['data.bytes should be number but is string']);
  });

  it('rejects present values with no supported report kind', () => {
    expect(dataProblems(manifest(spec), { input: undefined, bytes: 1, output: null })).toEqual([
      'data.input should be string but is unknown',
    ]);
  });

  it('catches a missing field and an undeclared one', () => {
    expect(dataProblems(manifest(spec), { input: 'a', bytes: 1 })).toContain('data.output is declared but missing');
    expect(dataProblems(manifest(spec), { input: 'a', bytes: 1, output: null, extra: 1 })).toContain(
      'data.extra is not in the declared schema',
    );
  });

  it('lets an optional field be absent, but checks it when present', () => {
    const withOptional = manifest({ ...spec, optional: { gps: 'object|null' } });
    expect(dataProblems(withOptional, { input: 'a', bytes: 1, output: null })).toEqual([]);
    expect(dataProblems(withOptional, { input: 'a', bytes: 1, output: null, gps: 'nope' })).toEqual([
      'data.gps should be object|null but is string',
    ]);
  });

  it('handles a table of rows', () => {
    const table = manifest({ shape: 'array', row: { mount: 'string', use_percent: 'number' } });
    expect(dataProblems(table, [{ mount: '/', use_percent: 4 }])).toEqual([]);
    expect(dataProblems(table, { mount: '/' })).toEqual(['data should be an array but is object']);
    expect(dataProblems(table, [{ mount: '/' }])).toEqual(['data[0].use_percent is declared but missing']);
  });

  it('checks nested objects, table rows, and scalar array items', () => {
    const nested = manifest({
      shape: 'object',
      required: {
        host: {
          shape: 'object',
          required: { name: 'string' },
          optional: { cores: 'number' },
        },
        samples: { shape: 'array', items: 'number' },
        segments: { shape: 'array', row: { offset: 'number', label: 'string' } },
      },
    });

    expect(
      dataProblems(nested, {
        host: { name: 'demo', cores: 4 },
        samples: [1, 2],
        segments: [{ offset: 0, label: 'EXIF' }],
      }),
    ).toEqual([]);
    expect(
      dataProblems(nested, {
        host: { name: 7, extra: true },
        samples: [1, 'two'],
        segments: [{ offset: 'zero', label: 'EXIF' }],
      }),
    ).toEqual([
      'data.host.name should be string but is number',
      'data.host.extra is not in the declared schema',
      'data.samples[1] should be number but is string',
      'data.segments[0].offset should be number but is string',
    ]);
  });

  it('declares nothing and checks nothing when the manifest has no schema', () => {
    expect(dataProblems(manifest(undefined), { anything: true })).toEqual([]);
  });
});

describe('the runtime choke point', () => {
  /** A runtime with one local tool, and no engine needed. */
  async function runtimeFor(tool: LocalTool): Promise<Runtime> {
    const host = fakeHost();
    return Runtime.load(host, { home: '/home/tester/.gimlet', localTools: [tool] });
  }

  const report = (data: unknown) => ({
    tool: 'demo.shape',
    status: 'ok' as const,
    summary: 'ran',
    data,
    duration_ms: 1,
  });

  it('refuses a report that drifts from the manifest, so a consumer never sees it', async () => {
    const tool: LocalTool = {
      manifest: manifest({ shape: 'object', required: { bytes: 'number' } }),
      run: async () => report({ bytes: 'not a number' }),
    };
    const runtime = await runtimeFor(tool);
    await expect(runtime.run('demo.shape', {})).rejects.toThrow(/does not match its schema: data\.bytes/);
    runtime.close();
  });

  it('refuses a nested value that drifts from the manifest', async () => {
    const tool: LocalTool = {
      manifest: manifest({
        shape: 'object',
        required: { host: { shape: 'object', required: { cores: 'number' } } },
      }),
      run: async () => report({ host: { cores: 'many' } }),
    };
    const runtime = await runtimeFor(tool);
    await expect(runtime.run('demo.shape', {})).rejects.toThrow(/data\.host\.cores should be number/);
    runtime.close();
  });

  it('passes a report that matches', async () => {
    const tool: LocalTool = {
      manifest: manifest({ shape: 'object', required: { bytes: 'number' } }),
      run: async () => report({ bytes: 12 }),
    };
    const runtime = await runtimeFor(tool);
    const { report: produced } = await runtime.run('demo.shape', {});
    expect(produced.data).toEqual({ bytes: 12 });
    runtime.close();
  });
});

describe('the shipped tools', () => {
  it('every tool declares the shape of its data', () => {
    // A tool without one gets no runtime check and no consumer contract; this is
    // the only place that is enforced, so it is worth being strict about.
    const undeclared = NODE_TOOLS.filter((tool) => tool.manifest.data === undefined).map((tool) => tool.manifest.id);
    expect(undeclared).toEqual([]);
  });

  it('every declared field is one the checker understands', () => {
    const known = new Set(['string', 'number', 'boolean', 'null', 'object', 'array', 'unknown']);

    const checkSpec = (toolId: string, field: string, value: DataFieldSpec): void => {
      if (typeof value === 'string') {
        for (const kind of value.split('|')) {
          expect(known.has(kind), `${toolId}.${field} declares '${kind}'`).toBe(true);
        }
        return;
      }
      if (value.shape === 'object') {
        for (const [name, nested] of Object.entries({ ...value.required, ...value.optional })) {
          checkSpec(toolId, `${field}.${name}`, nested);
        }
        return;
      }
      for (const [name, nested] of Object.entries(value.row ?? {})) {
        checkSpec(toolId, `${field}.${name}`, nested);
      }
      if (value.items !== undefined) checkSpec(toolId, `${field}[]`, value.items);
    };

    for (const tool of NODE_TOOLS) {
      const spec = tool.manifest.data!;
      const fields = spec.shape === 'array' ? (spec.row ?? {}) : { ...spec.required, ...spec.optional };
      for (const [field, accepted] of Object.entries(fields) as [string, DataFieldSpec][]) {
        checkSpec(tool.manifest.id, field, accepted);
      }
      if (spec.shape === 'array' && spec.items !== undefined) checkSpec(tool.manifest.id, '[]', spec.items);
    }
  });
});
