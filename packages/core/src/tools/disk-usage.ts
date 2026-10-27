/**
 * Filesystem utilisation with warning and critical thresholds.
 *
 * `df -kP` is the one external process the built-in tools run: portable,
 * already installed, and the only thing that reports *mounted* filesystems
 * rather than directories that happen to be large.
 */

import { booleanOr, optString, type Args } from '../args.js';
import { moduleSetting } from '../config.js';
import { notFound, toolFailed } from '../errors.js';
import { isAbsolute, join, normalize } from '../pathutil.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';
import { sealed, type Finding, type Report } from '../report.js';

const MANIFEST: ToolManifest = {
  id: 'sysadmin.disk-usage',
  title: 'Disk usage',
  summary: 'Filesystem utilisation with warning and critical thresholds',
  category: 'sysadmin',
  capabilities: ['system', 'process:exec'],
  args: [
    { name: 'path', type: 'path', help: 'Restrict the report to the filesystem holding this path' },
    { name: 'all', type: 'boolean', default: false, help: 'Include pseudo filesystems such as tmpfs' },
  ],
  tags: ['inspection', 'capacity', 'filesystem'],
  platforms: ['linux', 'macos'],
};

export interface DiskRow {
  filesystem: string;
  total_kb: number;
  used_kb: number;
  available_kb: number;
  use_percent: number;
  mount: string;
}

export const diskUsage: LocalTool = {
  manifest: MANIFEST,
  async run(ctx, args: Args): Promise<Report> {
    const started = Date.now();
    const includePseudo = booleanOr(args, 'all', false);
    const wanted = optString(args, 'path');

    let rows = (await readRows(ctx)).filter((row) => row.total_kb > 0);
    if (!includePseudo) rows = rows.filter((row) => !isPseudo(row.filesystem));

    if (wanted !== undefined) {
      if (!(await ctx.host.exists(wanted))) throw notFound(`${wanted} does not exist`);
      // `df` reports absolute mount points, so a relative `path=.` would never
      // match one until it is resolved.
      const absolute = await absolutePath(ctx, wanted);
      rows = rows.filter((row) => containsPath(row.mount, absolute));
      if (rows.length === 0) throw notFound(`no mounted filesystem contains ${absolute}`);
      rows.sort((a, b) => b.mount.length - a.mount.length);
      rows = rows.slice(0, 1);
    }

    const warn = moduleSetting(ctx.config, 'sysadmin', 'disk_warn_percent', 80);
    const critical = moduleSetting(ctx.config, 'sysadmin', 'disk_critical_percent', 92);

    const findings: Finding[] = [];
    for (const row of rows) {
      if (row.use_percent >= critical) {
        findings.push({
          severity: 'high',
          code: 'disk.critical',
          message: `${row.mount} is ${row.use_percent.toFixed(0)}% full`,
        });
      } else if (row.use_percent >= warn) {
        findings.push({
          severity: 'medium',
          code: 'disk.warning',
          message: `${row.mount} is ${row.use_percent.toFixed(0)}% full`,
        });
      }
    }

    const tightest = rows.reduce((max, row) => Math.max(max, row.use_percent), 0);
    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary: `${rows.length} filesystem(s) checked, highest utilisation ${tightest}%`,
      findings,
      data: rows,
      duration_ms: Date.now() - started,
    });
  },
};

async function readRows(ctx: ToolRunContext): Promise<DiskRow[]> {
  const result = await ctx.host.exec('df', ['-kP']);
  if (result.code !== 0) {
    if (result.code === 127) throw toolFailed('failed to execute `df`: not found');
    throw toolFailed(`\`df\` exited with status ${result.code}`);
  }
  return parseDf(result.stdout);
}

export function parseDf(raw: string): DiskRow[] {
  const rows: DiskRow[] = [];
  let pending = '';
  for (const line of raw.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    pending = pending === '' ? trimmed : `${pending} ${trimmed}`;
    const fields = pending.split(/\s+/);
    if (fields.length < 6) continue;

    const total = Number(fields[1]);
    const used = Number(fields[2]);
    const available = Number(fields[3]);
    if (![total, used, available].every((value) => Number.isInteger(value) && value >= 0)) {
      pending = '';
      continue;
    }
    const percent = Number(fields[4]!.replace(/%$/, ''));
    rows.push({
      filesystem: fields[0]!,
      total_kb: total,
      used_kb: used,
      available_kb: available,
      use_percent: Number.isFinite(percent) ? percent : 0,
      mount: fields.slice(5).join(' '),
    });
    pending = '';
  }
  return rows;
}

export function isPseudo(filesystem: string): boolean {
  return (
    ['tmpfs', 'devtmpfs', 'devfs', 'udev', 'none', 'efivarfs', 'squashfs'].includes(filesystem) ||
    filesystem.startsWith('cgroup')
  );
}

export function containsPath(mount: string, path: string): boolean {
  const cleanMount = normalize(mount);
  const cleanPath = normalize(path);
  if (cleanMount === '/') return cleanPath.startsWith('/');
  return cleanPath === cleanMount || cleanPath.startsWith(`${cleanMount}/`);
}

async function absolutePath(ctx: ToolRunContext, path: string): Promise<string> {
  if (isAbsolute(path)) return normalize(path);
  try {
    return await ctx.host.resolve(path);
  } catch {
    // A path that does not resolve cannot be compared with a mount point, so
    // the relative spelling is all that is left.
    return normalize(join(await ctx.host.resolve('.'), path));
  }
}
