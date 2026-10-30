/**
 * Declared capabilities are enforced, not described.
 *
 * A tool that writes a file without declaring `fs:write`, or starts a process
 * without `process:exec`, fails with `capability_denied` before the operation
 * happens. Reads are not gated: they cannot destroy anything, and `system` is
 * the capability that describes host inspection.
 */

import { describe, expect, it } from 'vitest';

import { guardedHost } from '../src/capabilities.js';
import { Runtime } from '../src/runtime.js';
import { fakeHost, type FakeHost } from './fake-host.js';
import type { LocalTool } from '../src/local.js';
import type { Report } from '../src/report.js';
import type { ToolManifest } from '../src/manifest.js';

const manifest = (capabilities: ToolManifest['capabilities']): ToolManifest => ({
  id: 'demo.caps',
  title: 'Demo',
  summary: 'demo',
  category: 'sysadmin',
  capabilities,
});

const report = (): Report => ({ tool: 'demo.caps', status: 'ok', summary: 'ran', duration_ms: 1 });

async function run(tool: LocalTool, host: FakeHost = fakeHost()): Promise<Report> {
  const runtime = await Runtime.load(host, { home: '/home/tester/.gimlet', localTools: [tool] });
  try {
    return (await runtime.run('demo.caps', {})).report;
  } finally {
    runtime.close();
  }
}

describe('declared capabilities', () => {
  it('refuses a write from a tool that did not declare fs:write', async () => {
    const tool: LocalTool = {
      manifest: manifest([]),
      async run(ctx) {
        await ctx.host.writeFile('/tmp/x', new Uint8Array([1]));
        return report();
      },
    };

    await expect(run(tool)).rejects.toMatchObject({ code: 'capability_denied' });
  });

  it('allows a write when fs:write is declared', async () => {
    const host = fakeHost();
    const tool: LocalTool = {
      manifest: manifest(['fs:write']),
      async run(ctx) {
        await ctx.host.writeFile('/tmp/x', new Uint8Array([1]));
        return report();
      },
    };

    await expect(run(tool, host)).resolves.toMatchObject({ status: 'ok' });
    expect(host.fileBytes.has('/tmp/x')).toBe(true);
  });

  it('refuses a subprocess from a tool that did not declare process:exec', async () => {
    const tool: LocalTool = {
      manifest: manifest(['fs:read']),
      async run(ctx) {
        await ctx.host.exec('df', ['-kP']);
        return report();
      },
    };

    await expect(run(tool)).rejects.toMatchObject({ code: 'capability_denied' });
  });

  it('allows a subprocess when process:exec is declared', async () => {
    const tool: LocalTool = {
      manifest: manifest(['process:exec']),
      async run(ctx) {
        const result = await ctx.host.exec('df', ['-kP']);
        expect(result.code).toBe(0);
        return report();
      },
    };

    await expect(run(tool)).resolves.toMatchObject({ status: 'ok' });
  });

  it('leaves reads alone', async () => {
    const tool: LocalTool = {
      manifest: manifest([]),
      async run(ctx) {
        expect(await ctx.host.exists('/anything')).toBe(false);
        return report();
      },
    };

    await expect(run(tool)).resolves.toMatchObject({ status: 'ok' });
  });

  it('does not wrap a tool that declared both enforced capabilities', () => {
    const host = fakeHost();
    expect(guardedHost(host, manifest(['fs:write', 'process:exec']))).toBe(host);
  });
});
