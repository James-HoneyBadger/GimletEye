/**
 * Host snapshot: identity, kernel, uptime, load, CPU, and memory.
 *
 * Reads `/proc` directly rather than shelling out, so the report is one set of
 * reads with no process to parse and no locale to depend on.
 */

import { sealed, type Report, type Severity } from '../report.js';
import { moduleSetting } from '../config.js';
import { unsupported } from '../errors.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';
import type { Args } from '../args.js';

const MANIFEST: ToolManifest = {
  id: 'sysadmin.system-info',
  title: 'System information',
  summary: 'Host identity, kernel, uptime, load, CPU, and memory snapshot',
  category: 'sysadmin',
  capabilities: ['system'],
  tags: ['inspection', 'snapshot', 'host'],
  platforms: ['linux'],
};

export const systemInfo: LocalTool = {
  manifest: MANIFEST,
  async run(ctx, _args: Args): Promise<Report> {
    if (ctx.host.platform !== 'linux') {
      throw unsupported('no readable /proc entries; system-info targets Linux');
    }
    const started = Date.now();
    const findings: Report['findings'] = [];
    const warnings: string[] = [];
    const data: Record<string, unknown> = {};

    const hostname = await readTrim(ctx, '/proc/sys/kernel/hostname');
    const kernel = await readTrim(ctx, '/proc/sys/kernel/osrelease');
    const os = parseOsRelease((await readTrim(ctx, '/etc/os-release')) ?? '');

    // Only what was actually readable is reported: a field of nulls would make
    // "no /proc here" indistinguishable from a healthy host.
    if (hostname !== undefined) data['hostname'] = hostname;
    if (kernel !== undefined) data['kernel'] = kernel;
    if (Object.keys(os).length > 0) {
      data['os'] = {
        id: os['ID'] ?? null,
        name: os['NAME'] ?? null,
        version: os['VERSION_ID'] ?? null,
        pretty_name: os['PRETTY_NAME'] ?? null,
      };
    }

    const uptimeSeconds = parseUptime((await readTrim(ctx, '/proc/uptime')) ?? '');
    if (uptimeSeconds === undefined) {
      warnings.push('/proc/uptime is not readable on this host');
    } else {
      data['uptime'] = { seconds: Math.floor(uptimeSeconds), human: humanUptime(uptimeSeconds) };
    }

    const load = parseLoadavg((await readTrim(ctx, '/proc/loadavg')) ?? '');
    if (load) {
      data['load'] = {
        avg_1m: load.load1,
        avg_5m: load.load5,
        avg_15m: load.load15,
        running: load.running,
        total: load.total,
      };
    }

    const cpu = parseCpuinfo((await readTrim(ctx, '/proc/cpuinfo')) ?? '');
    if (cpu.cores > 0) data['cpu'] = { model: cpu.model, cores: cpu.cores, mhz: cpu.mhz };

    const memory = parseMeminfo((await readTrim(ctx, '/proc/meminfo')) ?? '');
    let usedPercent = 0;
    const total = memory['MemTotal'];
    const available = memory['MemAvailable'];
    if (total !== undefined && available !== undefined && total > 0) {
      const used = Math.max(0, total - available);
      usedPercent = (used / total) * 100;
      data['memory'] = {
        total_kb: total,
        available_kb: available,
        used_kb: used,
        used_percent: round1(usedPercent),
      };
    }
    const swapTotal = memory['SwapTotal'];
    const swapFree = memory['SwapFree'];
    if (swapTotal !== undefined && swapFree !== undefined && swapTotal > 0) {
      data['swap'] = {
        total_kb: swapTotal,
        free_kb: swapFree,
        used_percent: round1((Math.max(0, swapTotal - swapFree) / swapTotal) * 100),
      };
    }

    const memoryWarn = moduleSetting(ctx.config, 'sysadmin', 'memory_warn_percent', 90);
    if (usedPercent >= memoryWarn) {
      findings.push({
        severity: 'high' as Severity,
        code: 'memory.pressure',
        message: `memory use is ${usedPercent.toFixed(1)}% (threshold ${memoryWarn.toFixed(0)}%)`,
      });
    }

    if (load && cpu.cores > 0) {
      const perCore = load.load1 / cpu.cores;
      const loadWarn = moduleSetting(ctx.config, 'sysadmin', 'load_warn_per_core', 2);
      if (perCore >= loadWarn) {
        findings.push({
          severity: 'medium' as Severity,
          code: 'load.high',
          message: `1m load is ${perCore.toFixed(2)} per core (threshold ${loadWarn.toFixed(2)})`,
        });
      }
    }

    if (Object.keys(data).length === 0) {
      throw unsupported('no readable /proc entries; system-info targets Linux');
    }
    data['arch'] = ctx.host.arch;

    const summary = [
      hostname ?? 'unknown host',
      os['PRETTY_NAME'] ?? 'unknown OS',
      `${cpu.cores} cores`,
      uptimeSeconds === undefined ? 'up unknown' : `up ${humanUptime(uptimeSeconds)}`,
    ].join(' · ');

    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary,
      findings,
      data,
      warnings,
      duration_ms: Date.now() - started,
    });
  },
};

async function readTrim(ctx: ToolRunContext, path: string): Promise<string | undefined> {
  try {
    const text = (await ctx.host.readTextFile(path)).trim();
    return text === '' ? undefined : text;
  } catch {
    return undefined;
  }
}

export function parseOsRelease(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at <= 0) continue;
    const key = trimmed.slice(0, at);
    let value = trimmed.slice(at + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export function parseUptime(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  // `Number('')` is 0, which would report a host that has just booted rather
  // than a host whose uptime could not be read.
  const value = Number(trimmed.split(/\s+/)[0]);
  return Number.isFinite(value) ? value : undefined;
}

export interface LoadAverage {
  load1: number;
  load5: number;
  load15: number;
  running: number;
  total: number;
}

export function parseLoadavg(raw: string): LoadAverage | undefined {
  const fields = raw.trim().split(/\s+/);
  if (fields.length < 4) return undefined;
  const [load1, load5, load15] = fields.slice(0, 3).map(Number);
  const [running, total] = fields[3]!.split('/').map(Number);
  if ([load1, load5, load15, running, total].some((value) => value === undefined || Number.isNaN(value))) {
    return undefined;
  }
  return { load1: load1!, load5: load5!, load15: load15!, running: running!, total: total! };
}

export interface CpuInfo {
  model: string;
  cores: number;
  mhz?: number;
}

export function parseCpuinfo(raw: string): CpuInfo {
  let model = '';
  let cores = 0;
  let mhz: number | undefined;
  for (const line of raw.split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key === 'processor') cores += 1;
    if (key === 'model name' && model === '') model = value;
    if ((key === 'cpu MHz' || key === 'cpu MHz\t') && mhz === undefined) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) mhz = parsed;
    }
  }
  return mhz === undefined ? { model, cores } : { model, cores, mhz };
}

export function parseMeminfo(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    const amount = Number(line.slice(at + 1).trim().split(/\s+/)[0]);
    if (Number.isFinite(amount)) out[key] = amount;
  }
  return out;
}

export function humanUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
