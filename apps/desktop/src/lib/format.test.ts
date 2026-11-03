import { describe, expect, it } from 'vitest';

import { cliCommand, elapsed, formatWhen, humanDuration, matchesQuery, searchText, truncate } from './format';

const scan = {
  id: 'privacy.metadata-scan',
  title: 'Inspect metadata',
  summary: 'Report every metadata segment in a file',
  tags: ['metadata', 'exif'],
  capabilities: ['fs:read'],
  args: [
    { name: 'input', help: 'File to inspect' },
    { name: 'policy', help: 'Removal profile' },
  ],
};

describe('matchesQuery', () => {
  it('matches everything when the query is blank', () => {
    expect(matchesQuery(scan, '   ')).toBe(true);
  });

  it('matches capabilities, as the search box promises', () => {
    expect(matchesQuery(scan, 'fs:read')).toBe(true);
  });

  it('matches argument names and their help text', () => {
    expect(matchesQuery(scan, 'input')).toBe(true);
    expect(matchesQuery(scan, 'removal profile')).toBe(true);
  });

  it('requires every word of a multi-word query', () => {
    expect(matchesQuery(scan, 'metadata exif')).toBe(true);
    expect(matchesQuery(scan, 'metadata signature')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(matchesQuery(scan, 'INSPECT')).toBe(true);
  });
});

describe('searchText', () => {
  it('covers the whole manifest', () => {
    const text = searchText(scan);
    for (const part of ['privacy.metadata-scan', 'inspect metadata', 'fs:read', 'removal profile']) {
      expect(text).toContain(part.toLowerCase());
    }
  });
});

describe('cliCommand', () => {
  it('renders a copyable invocation', () => {
    expect(cliCommand('crypto.passgen', { length: 32 }, false)).toBe('gimlet-works run crypto.passgen length=32');
  });

  it('quotes values that need it', () => {
    expect(cliCommand('privacy.metadata-strip', { input: '/tmp/my photos/a.jpg' }, false)).toBe(
      "gimlet-works run privacy.metadata-strip 'input=/tmp/my photos/a.jpg'",
    );
  });

  it('escapes embedded single quotes', () => {
    expect(cliCommand('demo', { note: "it's" }, false)).toBe("gimlet-works run demo 'note=it'\\''s'");
  });

  it('appends --dry-run only when asked', () => {
    expect(cliCommand('demo', {}, true)).toBe('gimlet-works run demo --dry-run');
  });

  it('skips empty values', () => {
    expect(cliCommand('demo', { a: '', b: 'x' }, false)).toBe('gimlet-works run demo b=x');
  });

  it('never puts a passphrase in a command that will be copied', () => {
    expect(cliCommand('crypto.encrypt', { input: 'a.txt', passphrase: 'hunter2' }, false)).toBe(
      "gimlet-works run crypto.encrypt input=a.txt 'passphrase=<redacted>'",
    );
    expect(cliCommand('crypto.key-rotate', { new_passphrase_env: 'X', passphrase: 'pw' }, false)).toBe(
      "gimlet-works run crypto.key-rotate new_passphrase_env=X 'passphrase=<redacted>'",
    );
    // `secret=true` is a flag, not a secret: the unredacted command is correct.
    expect(cliCommand('crypto.key-export', { secret: true }, false)).toBe('gimlet-works run crypto.key-export secret=true');
  });
});

describe('humanDuration', () => {
  it('scales with magnitude', () => {
    expect(humanDuration(12)).toBe('12 ms');
    expect(humanDuration(1500)).toBe('1.50 s');
    expect(humanDuration(65_000)).toBe('1m 5s');
  });
});

describe('truncate', () => {
  it('leaves short values alone and ellipsizes long ones', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abcdef', 4)).toBe('abc…');
  });
});

describe('formatWhen', () => {
  it('falls back to the raw value when the timestamp is unparseable', () => {
    expect(formatWhen('not-a-date')).toBe('not-a-date');
  });

  it('renders a time for today', () => {
    const now = new Date().toISOString();
    expect(formatWhen(now)).toMatch(/\d/);
  });
});

describe('elapsed', () => {
  const at = (iso: string): number => new Date(iso).getTime();
  const now = at('2026-10-31T12:00:00Z');

  it('says "just now" for the last few seconds', () => {
    expect(elapsed('2026-10-31T11:59:50Z', now)).toBe('just now');
  });

  it('counts minutes, hours, days, and months', () => {
    expect(elapsed('2026-10-31T11:57:00Z', now)).toBe('3m ago');
    expect(elapsed('2026-10-31T09:00:00Z', now)).toBe('3h ago');
    expect(elapsed('2026-10-28T12:00:00Z', now)).toBe('3d ago');
    expect(elapsed('2026-08-31T12:00:00Z', now)).toBe('2mo ago');
  });

  it('says nothing about a timestamp it cannot read', () => {
    expect(elapsed('not-a-date', now)).toBe('');
  });

  it('does not report a future run as negative', () => {
    expect(elapsed('2026-10-31T12:05:00Z', now)).toBe('just now');
  });
});
