import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/config.js';
import { failedLoginDetector, parseFailures } from '../src/tools/failed-login.js';
import { describeMode, filePermissions, issuesFor } from '../src/tools/file-permissions.js';
import { parsePasswd, parseShadow, userAudit } from '../src/tools/user-audit.js';
import { fakeHost } from './fake-host.js';

const ctxFor = (host: ReturnType<typeof fakeHost>) => ({ host, config: defaultConfig(), dryRun: false, paths: {} as never });

const codes = (report: { findings?: { code: string; severity: string }[] }): string[] =>
  (report.findings ?? []).map((finding) => `${finding.code}:${finding.severity}`);

describe('file permissions', () => {
  it('spells a mode the way ls does', () => {
    expect(describeMode(0o755)).toBe('0755');
    expect(describeMode(0o4755)).toBe('4755');
    expect(describeMode(0o644)).toBe('0644');
  });

  it('grades each bit against what it enables', () => {
    expect(issuesFor(0o666, false, false)).toEqual([{ issue: 'world-writable file', severity: 'medium' }]);
    expect(issuesFor(0o777, true, false)).toEqual([{ issue: 'world-writable directory', severity: 'high' }]);
    expect(issuesFor(0o1777, true, false)).toEqual([]);
    expect(issuesFor(0o4755, false, false)).toEqual([{ issue: 'setuid file', severity: 'medium' }]);
    expect(issuesFor(0o4777, false, false)).toEqual([
      { issue: 'world-writable setuid file', severity: 'critical' },
    ]);
    expect(issuesFor(0o664, false, true)).toEqual([{ issue: 'group-writable file', severity: 'low' }]);
    expect(issuesFor(0o664, false, false)).toEqual([]);
  });

  it('reports each hazard under a path and seals the verdict', async () => {
    const host = fakeHost();
    host.dirs.add('/tree');
    host.modes.set('/tree', 0o755);
    host.files.set('/tree/open.txt', 'x');
    host.modes.set('/tree/open.txt', 0o666);
    host.dirs.add('/tree/shared');
    host.modes.set('/tree/shared', 0o777);
    host.files.set('/tree/suid', '');
    host.modes.set('/tree/suid', 0o4755);

    const report = await filePermissions.run(ctxFor(host), { path: '/tree' });
    const rows = report.data as { path: string; issue: string; mode: string }[];
    expect(rows.map((row) => `${row.path} ${row.mode} ${row.issue}`)).toEqual([
      '/tree/shared 0777 world-writable directory',
      '/tree/open.txt 0666 world-writable file',
      '/tree/suid 4755 setuid file',
    ]);
    expect(report.status).toBe('error');
    expect(codes(report)).toContain('permissions.world-writable-directory:high');
    expect(report.summary).toContain('4 entries scanned');
  });

  it('stops descending at max_depth', async () => {
    const host = fakeHost();
    host.dirs.add('/tree');
    host.modes.set('/tree', 0o755);
    host.dirs.add('/tree/deep');
    host.modes.set('/tree/deep', 0o755);
    host.files.set('/tree/deep/open.txt', 'x');
    host.modes.set('/tree/deep/open.txt', 0o666);

    const shallow = await filePermissions.run(ctxFor(host), { path: '/tree', max_depth: 0 });
    expect((shallow.data as unknown[]).length).toBe(0);

    const deep = await filePermissions.run(ctxFor(host), { path: '/tree', max_depth: 2 });
    expect((deep.data as unknown[]).length).toBe(1);
  });

  it('refuses a path that is not there, and a platform without modes', async () => {
    await expect(filePermissions.run(ctxFor(fakeHost()), { path: '/missing' })).rejects.toThrow(/does not exist/);
    await expect(filePermissions.run(ctxFor(fakeHost({ platform: 'windows' as never })), {})).rejects.toThrow(
      /targets Linux and macOS/,
    );
  });
});

describe('user audit', () => {
  it('parses passwd and skips what is not a record', () => {
    const accounts = parsePasswd('# comment\nroot:x:0:0:root:/root:/bin/bash\nbroken line\nalice:x:1000:1000::/home/alice:/bin/bash\n');
    expect(accounts).toEqual([
      { name: 'root', uid: 0, home: '/root', shell: '/bin/bash' },
      { name: 'alice', uid: 1000, home: '/home/alice', shell: '/bin/bash' },
    ]);
  });

  it('reads a shadow record by name without keeping the hash', () => {
    const passwords = parseShadow('root:$6$abc:19000::::::\nbob:!:19000::::::\n');
    expect(passwords.get('root')).toBe('$6$abc');
    expect(passwords.get('bob')).toBe('!');
  });

  it('names a second root, a shared id, a missing password, and a readable shadow', async () => {
    const host = fakeHost();
    host.files.set(
      '/etc/passwd',
      [
        'root:x:0:0:root:/root:/bin/bash',
        'toor:x:0:0::/root:/bin/bash',
        'alice:x:1000:1000::/home/alice:/bin/bash',
        'bob:x:1001:1001::/home/bob:/usr/sbin/nologin',
        '',
      ].join('\n'),
    );
    host.dirs.add('/root');
    host.dirs.add('/home/alice');
    host.files.set(
      '/etc/shadow',
      ['root:$6$abc:19000::::::', 'toor::19000::::::', 'alice:$6$def:19000::::::', 'bob:!:19000::::::', ''].join('\n'),
    );
    host.modes.set('/etc/shadow', 0o644);

    const report = await userAudit.run(ctxFor(host), {});
    const rows = report.data as { account: string; issue: string; severity: string }[];
    const described = rows.map((row) => `${row.account} ${row.issue} ${row.severity}`);

    expect(described).toContain('toor uid 0 account critical');
    expect(described).toContain('toor account has no password critical');
    expect(described).toContain('root duplicate uid with toor medium');
    expect(described).toContain('toor duplicate uid with root medium');
    expect(described.some((row) => row.startsWith('bob'))).toBe(false);
    expect(codes(report)).toContain('accounts.shadow-world-readable:critical');
    expect(report.status).toBe('error');
    // The hash is evidence for the check, never part of the report.
    expect(JSON.stringify(report)).not.toContain('$6$');
  });

  it('says the password database was unreadable instead of guessing', async () => {
    const host = fakeHost({
      async readTextFile(path) {
        if (path === '/etc/shadow') throw Object.assign(new Error('EACCES: /etc/shadow'), { code: 'EACCES' });
        return host.files.get(path) ?? '';
      },
    });
    host.files.set('/etc/passwd', 'root:x:0:0:root:/root:/bin/bash\n');
    host.files.set('/etc/shadow', '');
    host.modes.set('/etc/shadow', 0o600);
    host.dirs.add('/root');

    const report = await userAudit.run(ctxFor(host), {});
    expect(codes(report)).toContain('accounts.shadow-unreadable:info');
    expect(report.status).toBe('ok');
  });

  it('refuses a platform that keeps accounts somewhere else', async () => {
    await expect(userAudit.run(ctxFor(fakeHost({ platform: 'macos' as never })), {})).rejects.toThrow(/targets Linux/);
  });
});

describe('failed logins', () => {
  const log = [
    'Oct 27 10:00:00 host sshd[1]: Failed password for invalid user admin from 203.0.113.9 port 5000 ssh2',
    'Oct 27 10:00:00 host sshd[1]: Invalid user admin from 203.0.113.9 port 5000',
    'Oct 27 10:00:05 host sshd[1]: Failed password for root from 198.51.100.4 port 5001 ssh2',
    'Oct 27 10:00:10 host sudo: pam_unix(sudo:auth): authentication failure; logname= uid=0 euid=0 tty=/dev/pts/0 ruser= rhost= user=alice',
    'Oct 27 10:00:11 host sshd[1]: Accepted password for alice from 198.51.100.4 port 5002 ssh2',
    '',
  ].join('\n');

  it('counts one attempt per failure, not one per log line', () => {
    const counts = parseFailures(log);
    expect([...counts.values()]).toEqual([
      { user: 'admin', source: '203.0.113.9', attempts: 1 },
      { user: 'root', source: '198.51.100.4', attempts: 1 },
      { user: 'alice', source: 'local', attempts: 1 },
    ]);
  });

  it('reports the pairs at or above the threshold', async () => {
    const host = fakeHost();
    host.files.set('/var/log/auth.log', log);
    const report = await failedLoginDetector.run(ctxFor(host), { threshold: 1 });
    expect(report.status).toBe('error');
    expect(codes(report).filter((code) => code.startsWith('login.repeated-failure'))).toHaveLength(3);
    expect(report.summary).toContain('3 failure(s) from 3 account/source pair(s)');
  });

  it('reports nothing as a finding below the threshold', async () => {
    const host = fakeHost();
    host.files.set('/var/log/auth.log', log);
    const report = await failedLoginDetector.run(ctxFor(host), {});
    expect(report.status).toBe('ok');
    expect((report.data as unknown[]).length).toBe(3);
    expect(report.summary).toContain('0 at or above 5');
  });

  it('says so when there is no auth log at all', async () => {
    const report = await failedLoginDetector.run(ctxFor(fakeHost()), {});
    expect(report.status).toBe('ok');
    expect(codes(report)).toEqual(['login.no-auth-log:info']);
    expect(report.data).toEqual([]);
  });

  it('honours an explicit log and its missing file', async () => {
    const host = fakeHost();
    host.files.set('/logs/secure', log);
    const report = await failedLoginDetector.run(ctxFor(host), { log: '/logs/secure', limit: 2 });
    expect((report.data as unknown[]).length).toBe(2);
    await expect(failedLoginDetector.run(ctxFor(host), { log: '/logs/absent' })).rejects.toThrow(/does not exist/);
  });

  it('refuses a platform without these logs', async () => {
    await expect(failedLoginDetector.run(ctxFor(fakeHost({ platform: 'macos' as never })), {})).rejects.toThrow(
      /targets Linux/,
    );
  });
});
