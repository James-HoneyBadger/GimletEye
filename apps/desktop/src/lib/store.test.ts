// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { AuditEntry } from './engine';
import { lastRuns } from './store';

const entry = (tool: string, ts: string, status: AuditEntry['status']): AuditEntry => ({
  tool,
  ts,
  status,
  duration_ms: 1,
});

describe('lastRuns', () => {
  it('keeps the newest run of each tool', () => {
    const runs = lastRuns([
      entry('crypto.sha256', '2026-10-31T10:00:00Z', 'ok'),
      entry('crypto.sha256', '2026-10-31T11:00:00Z', 'warning'),
      entry('sysadmin.disk-usage', '2026-10-31T09:00:00Z', 'error'),
    ]);

    expect(runs.get('crypto.sha256')).toEqual({ ts: '2026-10-31T11:00:00Z', status: 'warning', runs: 2 });
    expect(runs.get('sysadmin.disk-usage')?.status).toBe('error');
  });

  it('says nothing about a tool that has not run', () => {
    expect(lastRuns([]).size).toBe(0);
    expect(lastRuns([entry('a', '2026-10-31T10:00:00Z', 'ok')]).get('b')).toBeUndefined();
  });

  it('does not depend on the order the trail is read in', () => {
    const forward = lastRuns([
      entry('a', '2026-10-31T09:00:00Z', 'ok'),
      entry('a', '2026-10-31T10:00:00Z', 'error'),
    ]);
    const backward = lastRuns([
      entry('a', '2026-10-31T10:00:00Z', 'error'),
      entry('a', '2026-10-31T09:00:00Z', 'ok'),
    ]);
    expect(forward.get('a')).toEqual(backward.get('a'));
  });
});
