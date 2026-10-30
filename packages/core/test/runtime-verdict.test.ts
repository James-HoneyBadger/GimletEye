/**
 * The verdict gate at the runtime, and what crosses from an engine.
 *
 * Both exist because a report can be produced somewhere this build does not
 * control: a tool of its own, or the optional engine. The rules are the same
 * either way — a high finding cannot be reported as ok, a reported error is not
 * upgraded, and a value the renderer does not understand is refused rather than
 * passed through.
 */

import { describe, expect, it } from 'vitest';

import { assertManifest, assertReport } from '../src/sidecar.js';
import { Runtime } from '../src/runtime.js';
import { fakeHost } from './fake-host.js';
import type { LocalTool } from '../src/local.js';
import type { Report } from '../src/report.js';

const report = (overrides: Partial<Report> = {}): Report => ({
  tool: 'demo.verdict',
  status: 'ok',
  summary: 'demo',
  duration_ms: 1,
  ...overrides,
});

function tool(produce: () => Report): LocalTool {
  return {
    manifest: { id: 'demo.verdict', title: 'Demo', summary: 'demo', category: 'sysadmin' },
    run: async () => produce(),
  };
}

async function runtimeFor(local: LocalTool): Promise<Runtime> {
  return Runtime.load(fakeHost(), { home: '/home/tester/.gimlet', localTools: [local] });
}

describe('the runtime verdict', () => {
  it('refuses a tool id nobody registered, as usage rather than a missing file', async () => {
    const runtime = await runtimeFor(tool(() => report()));
    await expect(runtime.run('nope', {})).rejects.toMatchObject({ code: 'unknown_tool' });
    runtime.close();
  });

  it('turns a high finding into an error, whatever the tool said', async () => {
    const runtime = await runtimeFor(
      tool(() => report({ findings: [{ severity: 'high', code: 'x', message: 'boom' }] })),
    );
    const { report: produced } = await runtime.run('demo.verdict', {});
    expect(produced.status).toBe('error');
    runtime.close();
  });

  it('does not upgrade a reported error with no findings', async () => {
    const runtime = await runtimeFor(tool(() => report({ status: 'error', summary: 'it failed' })));
    const { report: produced } = await runtime.run('demo.verdict', {});
    expect(produced.status).toBe('error');
    runtime.close();
  });

  it('refuses an unknown argument before the tool runs', async () => {
    let ran = false;
    const runtime = await runtimeFor({
      manifest: {
        id: 'demo.verdict',
        title: 'Demo',
        summary: 'demo',
        category: 'sysadmin',
        args: [{ name: 'input', type: 'path' }],
      },
      run: async () => {
        ran = true;
        return report();
      },
    });

    await expect(runtime.run('demo.verdict', { surprise: 1 })).rejects.toMatchObject({ code: 'invalid_args' });
    expect(ran).toBe(false);
    runtime.close();
  });
});

describe('a manifest from the engine', () => {
  const good = { id: 'demo.one', title: 'Demo', summary: 'demo', category: 'privacy' };

  it('accepts a minimal manifest', () => {
    expect(assertManifest(good, 0).id).toBe('demo.one');
  });

  it('refuses a category this build does not know', () => {
    expect(() => assertManifest({ ...good, category: 'magic' }, 0)).toThrow(/category/);
  });

  it('refuses an argument type the form cannot render', () => {
    expect(() => assertManifest({ ...good, args: [{ name: 'x', type: 'file' }] }, 0)).toThrow(/args\[0\] has type/);
  });

  it('refuses a capability this build does not know', () => {
    expect(() => assertManifest({ ...good, capabilities: ['network:raw'] }, 0)).toThrow(/capabilities/);
  });

  it('refuses a data shape without its required map', () => {
    expect(() => assertManifest({ ...good, data: { shape: 'object' } }, 0)).toThrow(/data\.required/);
  });
});

describe('a report from the engine', () => {
  it('accepts a well-formed report', () => {
    expect(assertReport(report({ status: 'warning' }), 'demo.verdict').status).toBe('warning');
  });

  it('refuses a status the renderers do not know', () => {
    expect(() => assertReport({ ...report(), status: 'fine' }, 'demo.verdict')).toThrow(/status/);
  });

  it('refuses an unknown severity instead of treating it as no finding', () => {
    // `sealed()` rates an unknown severity as *not a finding*, so passing one
    // through would report a critical result as ok.
    expect(() =>
      assertReport(
        report({ findings: [{ severity: 'urgent' as unknown as 'high', code: 'c', message: 'm' }] }),
        'demo.verdict',
      ),
    ).toThrow(/severity/);
  });

  it('refuses a finding without a code or a message', () => {
    expect(() =>
      assertReport(
        report({ findings: [{ severity: 'high', code: '', message: 4 as unknown as string }] }),
        'demo.verdict',
      ),
    ).toThrow(/code and message/);
  });

  it('refuses a target that is not a string', () => {
    expect(() =>
      assertReport(
        report({ findings: [{ severity: 'low', code: 'c', message: 'm', target: 9 as unknown as string }] }),
        'demo.verdict',
      ),
    ).toThrow(/target/);
  });

  it('refuses a report for a different tool', () => {
    // The renderer trusts `tool`, and the audit records the id that was asked
    // for; a mismatch is a bug in one of them, not something to print.
    expect(() => assertReport({ ...report(), tool: 'other.tool' }, 'demo.verdict')).toThrow(/does not match/);
  });

  it('refuses warnings or a body of the wrong type', () => {
    expect(() => assertReport({ ...report(), warnings: 'oops' as unknown as string[] }, 'demo.verdict')).toThrow(
      /warnings/,
    );
    expect(() => assertReport({ ...report(), body: 7 as unknown as string }, 'demo.verdict')).toThrow(/body/);
  });
});
