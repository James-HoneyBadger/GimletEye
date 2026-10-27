import { describe, expect, it } from 'vitest';

import {
  humanUptime,
  parseCpuinfo,
  parseLoadavg,
  parseMeminfo,
  parseOsRelease,
  parseUptime,
  systemInfo,
} from '../src/tools/system-info.js';
import { containsPath, isPseudo, parseDf, diskUsage } from '../src/tools/disk-usage.js';
import { defaultConfig } from '../src/config.js';
import { fakeHost } from './fake-host.js';

describe('system-info parsing', () => {
  it('reads os-release, including quoted values', () => {
    const parsed = parseOsRelease('ID=debian\nNAME="Debian GNU/Linux"\n# a comment\n');
    expect(parsed['ID']).toBe('debian');
    expect(parsed['NAME']).toBe('Debian GNU/Linux');
  });

  it('reads uptime and load averages', () => {
    expect(parseUptime('3984.21 20000.00\n')).toBeCloseTo(3984.21);
    expect(parseUptime('')).toBeUndefined();
    const load = parseLoadavg('2.08 2.03 1.84 3/986 12345');
    expect(load).toEqual({ load1: 2.08, load5: 2.03, load15: 1.84, running: 3, total: 986 });
  });

  it('counts cores and prefers the first model name', () => {
    const cpu = parseCpuinfo('processor\t: 0\nmodel name\t: Example\nprocessor\t: 1\nmodel name\t: Example\n');
    expect(cpu.cores).toBe(2);
    expect(cpu.model).toBe('Example');
  });

  it('reads meminfo in kB', () => {
    expect(parseMeminfo('MemTotal:        8120636 kB\nMemAvailable:    3310344 kB\n')).toEqual({
      MemTotal: 8120636,
      MemAvailable: 3310344,
    });
  });

  it('formats uptime the way the report does', () => {
    expect(humanUptime(0)).toBe('0d 0h 0m');
    expect(humanUptime(90061)).toBe('1d 1h 1m');
  });
});

describe('system-info tool', () => {
  it('reports what /proc says and seals the verdict', async () => {
    const host = fakeHost();
    host.files.set('/proc/sys/kernel/hostname', 'demo\n');
    host.files.set('/proc/sys/kernel/osrelease', '6.1.0\n');
    host.files.set('/proc/uptime', '90061.00 1.00\n');
    host.files.set('/proc/loadavg', '0.10 0.20 0.30 1/100 42\n');
    host.files.set('/proc/cpuinfo', 'processor\t: 0\nmodel name\t: Demo CPU\nprocessor\t: 1\nmodel name\t: Demo CPU\n');
    host.files.set(
      '/proc/meminfo',
      'MemTotal: 1000 kB\nMemAvailable: 100 kB\nSwapTotal: 2000 kB\nSwapFree: 2000 kB\n',
    );

    const report = await systemInfo.run({ host, config: defaultConfig(), dryRun: false }, {});
    expect(report.tool).toBe('sysadmin.system-info');
    // 90% of memory with the default 90% threshold is a *high* finding.
    expect(report.status).toBe('error');
    expect(report.summary).toContain('demo');
    expect(report.data).toMatchObject({ hostname: 'demo', kernel: '6.1.0' });
    expect(report.findings?.[0]?.code).toBe('memory.pressure');
  });

  it('honours the configured memory threshold', async () => {
    const host = fakeHost();
    host.files.set('/proc/sys/kernel/hostname', 'demo\n');
    host.files.set('/proc/meminfo', 'MemTotal: 1000 kB\nMemAvailable: 500 kB\n');

    const config = defaultConfig();
    config.modules['sysadmin'] = { memory_warn_percent: 95 };
    const report = await systemInfo.run({ host, config, dryRun: false }, {});
    expect(report.findings ?? []).toHaveLength(0);
    expect(report.status).toBe('ok');
  });

  it('refuses a host with no /proc', async () => {
    const host = fakeHost();
    await expect(systemInfo.run({ host, config: defaultConfig(), dryRun: false }, {})).rejects.toThrow(
      /targets Linux/,
    );
  });
});

describe('disk-usage parsing', () => {
  it('parses df output and joins a wrapped mount point', () => {
    const rows = parseDf(
      'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 40 60 40% /\ntmpfs 10 1 9 10% /run/user/1000\n',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ filesystem: '/dev/sda1', total_kb: 100, use_percent: 40, mount: '/' });
    expect(rows[1]?.mount).toBe('/run/user/1000');
  });

  it('joins a device name that df wrapped onto its own line', () => {
    const rows = parseDf(
      'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/mapper/a-very-long-volume-name\n100 40 60 40% /very/long/mount\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filesystem).toBe('/dev/mapper/a-very-long-volume-name');
    expect(rows[0]?.mount).toBe('/very/long/mount');
  });

  it('knows which filesystems are pseudo', () => {
    expect(isPseudo('tmpfs')).toBe(true);
    expect(isPseudo('cgroup2')).toBe(true);
    expect(isPseudo('/dev/nvme0n1p2')).toBe(false);
  });

  it('matches a nested path against its mount', () => {
    expect(containsPath('/', '/home/user')).toBe(true);
    expect(containsPath('/home', '/home/user')).toBe(true);
    expect(containsPath('/home', '/var/log')).toBe(false);
    // `/home` must not match `/homework`.
    expect(containsPath('/home', '/homework')).toBe(false);
  });
});

describe('disk-usage tool', () => {
  it('warns at the configured threshold and reports every row', async () => {
    const host = fakeHost();
    host.execResult = {
      code: 0,
      stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 95 5 95% /\n',
      stderr: '',
    };

    const report = await diskUsage.run({ host, config: defaultConfig(), dryRun: false }, {});
    expect(report.status).toBe('error');
    expect(report.findings?.[0]).toMatchObject({ code: 'disk.critical' });
    expect(report.summary).toContain('highest utilisation 95%');
  });

  it('narrows to the filesystem holding a path', async () => {
    const host = fakeHost();
    host.execResult = {
      code: 0,
      stdout:
        'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 10 90 10% /\n/dev/sdb1 200 20 180 10% /data\n',
      stderr: '',
    };

    host.dirs.add('/data');
    host.files.set('/data/x', 'payload');
    const report = await diskUsage.run({ host, config: defaultConfig(), dryRun: false }, { path: '/data/x' });
    expect(report.data).toHaveLength(1);
    expect((report.data as { mount: string }[])[0]?.mount).toBe('/data');
  });

  it('reports a missing path rather than an empty table', async () => {
    const host = fakeHost();
    await expect(diskUsage.run({ host, config: defaultConfig(), dryRun: false }, { path: '/nope' })).rejects.toThrow(
      /does not exist/,
    );
  });
});
