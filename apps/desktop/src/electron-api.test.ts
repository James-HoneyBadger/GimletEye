import { describe, expect, it, vi } from 'vitest';

import type { Runtime, Report } from '@gimlet-eye/core';

import { createApi } from '../electron/api.js';

/**
 * The window's boundary, tested without Electron.
 *
 * `main.ts` only validates IPC input and forwards; everything that decides what
 * a request means lives in `api.ts`, so it can be checked here where CI has no
 * display.
 */
const report: Report = { tool: 'crypto.sha256', status: 'ok', summary: 'done', duration_ms: 1 };

function stubRuntime(overrides: {
  auditEnabled?: boolean;
  entries?: unknown[];
} = {}): { runtime: Runtime; run: ReturnType<typeof vi.fn>; auditTail: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({ tool: 'crypto.sha256', report }));
  const auditTail = vi.fn(async () => overrides.entries ?? []);
  const runtime = {
    engineVersion: '0.7.0',
    registry: {
      size: 21,
      list: () => [{ id: 'crypto.sha256' }],
    },
    paths: { root: '/home/tester/.gimlet' },
    config: { audit: { enabled: overrides.auditEnabled ?? true } },
    audit: { path: '/home/tester/.gimlet/audit.jsonl' },
    run,
    auditTail,
  } as unknown as Runtime;
  return { runtime, run, auditTail };
}

describe('the desktop boundary', () => {
  it('reports health without loading the runtime twice', async () => {
    const { runtime } = stubRuntime();
    const load = vi.fn(async () => runtime);
    const api = createApi(load);

    expect(await api.health()).toEqual({
      status: 'ok',
      version: expect.any(String),
      engine: '0.7.0',
      tools: 21,
      home: '/home/tester/.gimlet',
    });
    await api.health();
    // The thunk is what makes the first request pay for loading, not startup.
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('returns the catalogue the registry holds', async () => {
    const { runtime } = stubRuntime();
    const api = createApi(async () => runtime);
    expect(await api.tools()).toEqual([{ id: 'crypto.sha256' }]);
  });

  it('runs a tool and returns the report, passing the dry-run flag through', async () => {
    const { runtime, run } = stubRuntime();
    const api = createApi(async () => runtime);

    expect(await api.run('crypto.sha256', { text: 'abc' }, true)).toBe(report);
    expect(run).toHaveBeenCalledWith('crypto.sha256', { text: 'abc' }, { dryRun: true });
  });

  it('reports a disabled audit trail as empty rather than failing', async () => {
    const { runtime, auditTail } = stubRuntime({ auditEnabled: false });
    const api = createApi(async () => runtime);

    expect(await api.audit(10)).toEqual({
      entries: [],
      path: '/home/tester/.gimlet/audit.jsonl',
      enabled: false,
    });
    expect(auditTail).not.toHaveBeenCalled();
  });

  it('returns the tail it was asked for when auditing is on', async () => {
    const { runtime, auditTail } = stubRuntime({ entries: [{ tool: 'crypto.sha256' }] });
    const api = createApi(async () => runtime);

    expect((await api.audit(5)).entries).toHaveLength(1);
    expect(auditTail).toHaveBeenCalledWith(5);
  });
});
