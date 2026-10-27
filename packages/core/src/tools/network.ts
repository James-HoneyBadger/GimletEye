/**
 * The interfaces this host has, and where its traffic goes by default.
 *
 * Read from `/sys/class/net` and `/proc/net/route`, like the rest of the host
 * tools: no `ip` to parse, no locale, no output format to guess. A privacy
 * review usually starts by asking which interfaces are up, so that is what the
 * report leads with.
 */

import { sealed, type Report } from '../report.js';
import { unsupported } from '../errors.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';
import type { Args } from '../args.js';

const MANIFEST: ToolManifest = {
  id: 'sysadmin.network',
  title: 'Network interfaces',
  summary: 'Interfaces, their state, MTU and address, and the default route',
  category: 'sysadmin',
  capabilities: ['system'],
  tags: ['inspection', 'network', 'interfaces', 'privacy'],
  platforms: ['linux'],
};

export interface Interface {
  name: string;
  state: string;
  mtu: number | null;
  address: string | null;
}

export interface Route {
  interface: string;
  gateway: string;
  destination: string;
}

export const network: LocalTool = {
  manifest: MANIFEST,
  async run(ctx: ToolRunContext, _args: Args): Promise<Report> {
    if (ctx.host.platform !== 'linux') {
      throw unsupported('no /sys/class/net on this platform; network targets Linux');
    }

    const started = Date.now();
    const findings: Report['findings'] = [];
    const warnings: string[] = [];

    const names = (await readDirOrUndefined(ctx, '/sys/class/net')) ?? [];
    const interfaces: Interface[] = [];
    for (const name of [...names].sort()) {
      const base = `/sys/class/net/${name}`;
      const state = (await readOrUndefined(ctx, `${base}/operstate`)) ?? undefined;
      interfaces.push({
        name,
        state: state ?? 'unknown',
        mtu: numberOrNull(await readOrUndefined(ctx, `${base}/mtu`)),
        address: (await readOrUndefined(ctx, `${base}/address`)) ?? null,
      });
    }

    if (interfaces.length === 0) {
      warnings.push('no interfaces were readable in /sys/class/net');
    }

    for (const iface of interfaces) {
      if (iface.state !== 'up') {
        findings.push({
          severity: 'info',
          code: 'network.interface_down',
          message: `${iface.name} is ${iface.state}`,
          target: iface.name,
        });
      }
      if (iface.address === '00:00:00:00:00:00') {
        findings.push({
          severity: 'medium',
          code: 'network.null_address',
          message: `${iface.name} reports an all-zero hardware address`,
          target: iface.name,
        });
      }
    }

    const routesRaw = await readOrUndefined(ctx, '/proc/net/route');
    const routes = routesRaw === undefined ? [] : parseRoutes(routesRaw);
    const defaultRoute = routes.find((route) => route.destination === '0.0.0.0');

    if (routesRaw === undefined) {
      warnings.push('/proc/net/route is not readable on this host');
    } else if (defaultRoute === undefined) {
      findings.push({
        severity: 'medium',
        code: 'network.no_default_route',
        message: 'no default route: this host cannot reach anything off-link',
      });
    }

    const up = interfaces.filter((iface) => iface.state === 'up').length;
    const summary =
      `${interfaces.length} interface(s), ${up} up` +
      (defaultRoute === undefined ? ', no default route' : `, default via ${defaultRoute.gateway} on ${defaultRoute.interface}`);

    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary,
      findings,
      warnings,
      data: {
        interfaces,
        default_gateway: defaultRoute === null || defaultRoute === undefined ? null : defaultRoute.gateway,
      },
      duration_ms: Date.now() - started,
    });
  },
};

/**
 * `/proc/net/route` is hex in host byte order, which on the architectures this
 * ships for means the four octets read backwards.
 */
export function parseRoutes(raw: string): Route[] {
  const routes: Route[] = [];
  const lines = raw.split('\n').slice(1);
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3) continue;
    const [iface, destination, gateway] = fields;
    if (iface === undefined || destination === undefined || gateway === undefined) continue;
    routes.push({
      interface: iface,
      destination: decodeIpv4(destination),
      gateway: decodeIpv4(gateway),
    });
  }
  return routes;
}

export function decodeIpv4(hex: string): string {
  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return hex;
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join('.');
}

function numberOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function readOrUndefined(ctx: ToolRunContext, path: string): Promise<string | undefined> {
  try {
    return (await ctx.host.readTextFile(path)).trim();
  } catch {
    return undefined;
  }
}

async function readDirOrUndefined(ctx: ToolRunContext, path: string): Promise<string[] | undefined> {
  try {
    return await ctx.host.readDir(path);
  } catch {
    return undefined;
  }
}
