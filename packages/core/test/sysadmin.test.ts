import { describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/config.js';
import { gradeSetting, kernelHardening, HARDENING_CHECKS } from '../src/tools/kernel-hardening.js';
import { decodeIpv4, network, parseRoutes } from '../src/tools/network.js';
import { fakeHost } from './fake-host.js';

const ctxFor = (host: ReturnType<typeof fakeHost>) => ({ host, config: defaultConfig(), dryRun: false });

const sysctl = (name: string): string => `/proc/sys/${name.replaceAll('.', '/')}`;

describe('kernel hardening', () => {
  it('grades a setting by what the guide recommends', () => {
    expect(gradeSetting('kernel.randomize_va_space', 2)).toBe('ok');
    expect(gradeSetting('kernel.randomize_va_space', 1)).toBe('weak');
    expect(gradeSetting('kernel.randomize_va_space', 0)).toBe('exposed');
    expect(gradeSetting('kernel.kptr_restrict', 0)).toBe('exposed');
    expect(gradeSetting('net.ipv4.ip_forward', 1)).toBe('weak');
    expect(() => gradeSetting('kernel.not.a.setting', 1)).toThrow(/unknown setting/);
  });

  it('reports a hardened host as clean', async () => {
    const host = fakeHost();
    host.files.set(sysctl('kernel.randomize_va_space'), '2\n');
    host.files.set(sysctl('kernel.kptr_restrict'), '1\n');
    host.files.set(sysctl('kernel.dmesg_restrict'), '1\n');
    host.files.set(sysctl('kernel.yama.ptrace_scope'), '1\n');
    host.files.set(sysctl('kernel.unprivileged_bpf_disabled'), '2\n');
    host.files.set(sysctl('kernel.perf_event_paranoid'), '3\n');
    host.files.set(sysctl('fs.protected_hardlinks'), '1\n');
    host.files.set(sysctl('fs.protected_symlinks'), '1\n');
    host.files.set(sysctl('net.ipv4.ip_forward'), '0\n');

    const report = await kernelHardening.run(ctxFor(host), {});
    expect(report.status).toBe('ok');
    expect(report.findings?.filter((finding) => finding.severity !== 'info')).toEqual([]);
    expect(report.summary).toContain('recommended value');
  });

  it('names the exposed settings and keeps the severity honest', async () => {
    const host = fakeHost();
    host.files.set(sysctl('kernel.randomize_va_space'), '0\n');
    host.files.set(sysctl('kernel.kptr_restrict'), '0\n');
    host.files.set(sysctl('kernel.dmesg_restrict'), '0\n');

    const report = await kernelHardening.run(ctxFor(host), {});
    expect(report.status).toBe('error');
    const codes = (report.findings ?? []).map((finding) => `${finding.code}:${finding.severity}`);
    expect(codes).toContain('kernel.exposed:high');
    expect(report.summary).toMatch(/3 exposed/);
  });

  it('reports an unexposed setting as missing, not as a pass', async () => {
    const host = fakeHost();
    const report = await kernelHardening.run(ctxFor(host), {});
    const values = (report.data as { settings: { verdict: string }[] }).settings;
    expect(values).toHaveLength(HARDENING_CHECKS.length);
    expect(values.every((entry) => entry.verdict === 'missing')).toBe(true);
    expect(report.findings?.every((finding) => finding.severity === 'info')).toBe(true);
  });

  it('refuses a host with no /proc/sys', async () => {
    const host = fakeHost({ platform: 'macos' });
    await expect(kernelHardening.run(ctxFor(host), {})).rejects.toThrow(/targets Linux/);
  });
});

describe('network interfaces', () => {
  const routeTable = [
    'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
    'eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
    'eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0',
    '',
  ].join('\n');

  it('decodes the byte order /proc/net/route uses', () => {
    expect(decodeIpv4('0101A8C0')).toBe('192.168.1.1');
    expect(decodeIpv4('00000000')).toBe('0.0.0.0');
    expect(decodeIpv4('zz')).toBe('zz');
  });

  it('finds the default route', () => {
    const routes = parseRoutes(routeTable);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toEqual({ interface: 'eth0', destination: '0.0.0.0', gateway: '192.168.1.1' });
  });

  it('lists interfaces with their state, MTU, and address', async () => {
    const host = fakeHost();
    host.dirs.add('/sys/class/net');
    host.files.set('/sys/class/net/eth0/operstate', 'up\n');
    host.files.set('/sys/class/net/eth0/mtu', '1500\n');
    host.files.set('/sys/class/net/eth0/address', 'aa:bb:cc:dd:ee:ff\n');
    host.files.set('/sys/class/net/lo/operstate', 'unknown\n');
    host.files.set('/sys/class/net/lo/address', '00:00:00:00:00:00\n');
    host.files.set('/proc/net/route', routeTable);

    const report = await network.run(ctxFor(host), {});
    const data = report.data as { interfaces: { name: string; state: string; mtu: number; address: string }[] };
    expect(data.interfaces.map((iface) => iface.name)).toEqual(['eth0', 'lo']);
    expect(data.interfaces[0]).toEqual({ name: 'eth0', state: 'up', mtu: 1500, address: 'aa:bb:cc:dd:ee:ff' });
    expect(report.summary).toContain('2 interface(s), 1 up');
    expect(report.summary).toContain('default via 192.168.1.1 on eth0');
    expect((report.findings ?? []).some((finding) => finding.code === 'network.null_address')).toBe(true);
  });

  it('flags a host with no default route', async () => {
    const host = fakeHost();
    host.dirs.add('/sys/class/net');
    host.files.set('/sys/class/net/eth0/operstate', 'up\n');
    host.files.set('/proc/net/route', routeTable.split('\n')[0] ?? '');

    const report = await network.run(ctxFor(host), {});
    expect(report.status).toBe('warning');
    expect((report.findings ?? []).some((finding) => finding.code === 'network.no_default_route')).toBe(true);
  });

  it('warns rather than guessing when the tables are unreadable', async () => {
    const host = fakeHost();
    const report = await network.run(ctxFor(host), {});
    expect(report.warnings).toContain('/proc/net/route is not readable on this host');
    expect(report.warnings).toContain('no interfaces were readable in /sys/class/net');
  });
});
