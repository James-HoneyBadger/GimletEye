import { describe, expect, it } from 'vitest';

import { summariseAudit, type AuditEntry } from '../src/audit.js';

const entry = (tool: string, ts: string, status: AuditEntry['status']): AuditEntry => ({
  tool,
  ts,
  status,
  duration_ms: 1,
});

describe('summariseAudit', () => {
  it('keeps the newest run per tool and counts every run', () => {
    const { latest, counts } = summariseAudit([
      entry('a', '2026-10-31T09:00:00Z', 'ok'),
      entry('a', '2026-10-31T10:00:00Z', 'warning'),
      entry('b', '2026-10-31T08:00:00Z', 'error'),
    ]);

    expect(latest.get('a')).toEqual({ ts: '2026-10-31T10:00:00Z', status: 'warning', runs: 2 });
    expect(latest.get('b')).toEqual({ ts: '2026-10-31T08:00:00Z', status: 'error', runs: 1 });
    expect(counts).toEqual({ ok: 1, warning: 1, error: 1 });
  });

  it('does not depend on the order the trail was read in', () => {
    const forward = summariseAudit([entry('a', '2026-10-31T09:00:00Z', 'ok'), entry('a', '2026-10-31T10:00:00Z', 'error')]);
    const backward = summariseAudit([entry('a', '2026-10-31T10:00:00Z', 'error'), entry('a', '2026-10-31T09:00:00Z', 'ok')]);
    expect(forward.latest.get('a')).toEqual(backward.latest.get('a'));
  });

  it('says nothing about an empty trail', () => {
    const { latest, counts } = summariseAudit([]);
    expect(latest.size).toBe(0);
    expect(counts).toEqual({ ok: 0, warning: 0, error: 0 });
  });
});
