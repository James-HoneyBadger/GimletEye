import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/config.js';
import { pathsUnder } from '../src/paths.js';
import { configDrift, snapshotName } from '../src/tools/config-drift.js';
import { fakeHost } from './fake-host.js';

const ctxFor = (host: ReturnType<typeof fakeHost>) => ({
  host,
  config: defaultConfig(),
  dryRun: false,
  paths: pathsUnder('/home/tester/.config/gimlet'),
});

const snapshotPath = '/home/tester/.config/gimlet/data/drift/default.json';

function hostWith(config: Record<string, string>): ReturnType<typeof fakeHost> {
  const host = fakeHost();
  host.dirs.add('/etc/app');
  for (const [path, text] of Object.entries(config)) host.files.set(path, text);
  return host;
}

describe('config drift', () => {
  it('refuses a snapshot name that is a path', () => {
    expect(snapshotName('web-prod')).toBe('web-prod');
    expect(() => snapshotName('../escape')).toThrow(/may only contain/);
    expect(() => snapshotName('a/b')).toThrow(/may only contain/);
  });

  it('records a snapshot and then names what changed, added, and removed', async () => {
    const host = hostWith({ '/etc/app/one.conf': 'a\n', '/etc/app/two.conf': 'b\n' });
    const snapshot = await configDrift.run(ctxFor(host), { input: '/etc/app', snapshot: true });
    expect(snapshot.summary).toBe("recorded 2 file(s) as snapshot 'default'");
    expect(host.files.has(snapshotPath)).toBe(true);

    host.files.set('/etc/app/one.conf', 'changed\n');
    host.files.set('/etc/app/three.conf', 'new\n');
    host.files.delete('/etc/app/two.conf');

    const report = await configDrift.run(ctxFor(host), { input: '/etc/app' });
    const rows = report.data as { path: string; change: string }[];
    expect(rows.map((row) => `${row.change} ${row.path}`)).toEqual([
      'changed /etc/app/one.conf',
      'added /etc/app/three.conf',
      'removed /etc/app/two.conf',
    ]);
    expect(report.summary).toBe("1 added, 1 removed, 1 changed across 2 file(s) since snapshot 'default'");
    expect(report.status).toBe('warning');
  });

  it('reports nothing when nothing moved', async () => {
    const host = hostWith({ '/etc/app/one.conf': 'a\n' });
    await configDrift.run(ctxFor(host), { input: '/etc/app', snapshot: true });
    const report = await configDrift.run(ctxFor(host), { input: '/etc/app' });
    expect(report.data).toEqual([]);
    expect(report.status).toBe('ok');
  });

  it('does not write during a dry run', async () => {
    const host = hostWith({ '/etc/app/one.conf': 'a\n' });
    const ctx = { ...ctxFor(host), dryRun: true };
    const report = await configDrift.run(ctx, { input: '/etc/app', snapshot: true });
    expect(report.summary).toBe("would record 1 file(s) as snapshot 'default'");
    expect(host.files.has(snapshotPath)).toBe(false);
  });

  it('asks for a snapshot before it can compare, and survives a corrupt one', async () => {
    const host = hostWith({ '/etc/app/one.conf': 'a\n' });
    await expect(configDrift.run(ctxFor(host), { input: '/etc/app' })).rejects.toThrow(/snapshot=true first/);

    host.files.set(snapshotPath, 'not json');
    await expect(configDrift.run(ctxFor(host), { input: '/etc/app' })).rejects.toThrow(/not a snapshot/);
  });

  it('says when it stopped early instead of reporting a clean tree', async () => {
    const host = hostWith({ '/etc/app/one.conf': 'a\n', '/etc/app/two.conf': 'b\n' });
    const report = await configDrift.run(ctxFor(host), { input: '/etc/app', snapshot: true, max_entries: 1 });
    expect(report.findings?.map((finding) => finding.code)).toContain('drift.truncated');
    expect(report.summary).toContain('recorded 1 file(s)');
  });

  it('watches a single file as happily as a tree', async () => {
    const host = hostWith({ '/etc/app/one.conf': 'a\n' });
    await configDrift.run(ctxFor(host), { input: '/etc/app/one.conf', snapshot: true, name: 'single' });
    host.files.set('/etc/app/one.conf', 'b\n');
    const report = await configDrift.run(ctxFor(host), { input: '/etc/app/one.conf', name: 'single' });
    expect(report.summary).toContain('1 changed');
  });
});
