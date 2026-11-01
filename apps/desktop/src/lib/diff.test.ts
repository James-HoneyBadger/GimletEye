import { describe, expect, it } from 'vitest';

import { diffData } from './diff';

describe('report diff', () => {
  it('separates rows that were added, removed, or changed', () => {
    const before = [
      { path: '/etc/passwd', mode: '0644', issue: 'none' },
      { path: '/tmp/old', mode: '0777', issue: 'world-writable' },
    ];
    const after = [
      { path: '/etc/passwd', mode: '0600', issue: 'none' },
      { path: '/tmp/new', mode: '0777', issue: 'world-writable' },
    ];

    const { changes } = diffData(before, after);
    expect(changes.map((change) => `${change.kind} ${change.key}`)).toEqual([
      'changed path:/etc/passwd',
      'added path:/tmp/new',
      'removed path:/tmp/old',
    ]);
    expect(changes[0]?.fields).toEqual(['mode']);
  });

  it('reports nothing when the two runs agree', () => {
    const rows = [{ path: '/a', mode: '0600' }];
    expect(diffData(rows, rows).changes).toEqual([]);
  });

  it('compares scalar objects key by key', () => {
    const { changes } = diffData({ chunks: 3, algorithm: 'x' }, { chunks: 4, algorithm: 'x' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'changed', key: 'chunks' });
  });
});
