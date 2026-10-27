/**
 * Kernel settings that decide what one user can learn about another.
 *
 * These are the sysctls a hardening guide names first, read straight out of
 * /proc/sys so there is nothing to parse and no program to trust. A missing file
 * is reported as missing rather than as a pass: an unexposed setting is not the
 * same as a hardened one.
 */

import { sealed, type Report } from '../report.js';
import { unsupported } from '../errors.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';
import type { Args } from '../args.js';

const MANIFEST: ToolManifest = {
  id: 'sysadmin.kernel-hardening',
  title: 'Kernel hardening',
  summary: 'Sysctls that expose one user to another, and what this host sets them to',
  category: 'sysadmin',
  capabilities: ['system'],
  tags: ['inspection', 'privacy', 'security', 'kernel', 'hardening'],
  platforms: ['linux'],
};

type Grade = 'ok' | 'weak' | 'exposed';

interface Check {
  readonly name: string;
  readonly path: string;
  readonly want: string;
  /** Values that pass, mapped to the verdict when they are seen. */
  readonly grade: (value: number) => Grade;
  readonly why: string;
}

const atLeast = (threshold: number): ((value: number) => Grade) => (value) =>
  value >= threshold ? 'ok' : value > 0 ? 'weak' : 'exposed';
const isOne = (value: number): Grade => (value === 1 ? 'ok' : 'exposed');

const CHECKS: readonly Check[] = [
  {
    name: 'kernel.randomize_va_space',
    path: '/proc/sys/kernel/randomize_va_space',
    want: '2',
    grade: atLeast(2),
    why: 'full address-space randomisation makes a memory bug harder to aim',
  },
  {
    name: 'kernel.kptr_restrict',
    path: '/proc/sys/kernel/kptr_restrict',
    want: '>= 1',
    grade: atLeast(1),
    why: 'unprivileged readers otherwise learn kernel addresses from /proc',
  },
  {
    name: 'kernel.dmesg_restrict',
    path: '/proc/sys/kernel/dmesg_restrict',
    want: '1',
    grade: isOne,
    why: 'the kernel log leaks addresses and device detail to any user',
  },
  {
    name: 'kernel.yama.ptrace_scope',
    path: '/proc/sys/kernel/yama/ptrace_scope',
    want: '>= 1',
    grade: atLeast(1),
    why: 'without it one process may read another user\'s memory',
  },
  {
    name: 'kernel.unprivileged_bpf_disabled',
    path: '/proc/sys/kernel/unprivileged_bpf_disabled',
    want: '>= 1',
    grade: atLeast(1),
    why: 'unprivileged BPF has been a repeat source of privilege escalation',
  },
  {
    name: 'kernel.perf_event_paranoid',
    path: '/proc/sys/kernel/perf_event_paranoid',
    want: '>= 2',
    grade: atLeast(2),
    why: 'perf can otherwise sample other users\' memory',
  },
  {
    name: 'fs.protected_hardlinks',
    path: '/proc/sys/fs/protected_hardlinks',
    want: '1',
    grade: isOne,
    why: 'hardlink tricks let one user corrupt another user\'s files',
  },
  {
    name: 'fs.protected_symlinks',
    path: '/proc/sys/fs/protected_symlinks',
    want: '1',
    grade: isOne,
    why: 'symlink tricks in world-writable directories escalate to the writer',
  },
  {
    name: 'net.ipv4.ip_forward',
    path: '/proc/sys/net/ipv4/ip_forward',
    want: '0',
    grade: (value) => (value === 0 ? 'ok' : 'weak'),
    why: 'a workstation that forwards is acting as a router',
  },
];

export const kernelHardening: LocalTool = {
  manifest: MANIFEST,
  async run(ctx: ToolRunContext, _args: Args): Promise<Report> {
    if (ctx.host.platform !== 'linux') {
      throw unsupported('no /proc/sys on this platform; kernel-hardening targets Linux');
    }

    const started = Date.now();
    const findings: Report['findings'] = [];
    const settings: Record<string, unknown>[] = [];
    let exposed = 0;
    let weak = 0;
    let missing = 0;

    for (const check of CHECKS) {
      const raw = await readOrUndefined(ctx, check.path);
      if (raw === undefined) {
        missing += 1;
        settings.push({ name: check.name, value: null, want: check.want, verdict: 'missing' });
        findings.push({
          severity: 'info',
          code: 'kernel.not_exposed',
          message: `${check.name} is not exposed on this kernel; it cannot be checked`,
          target: check.path,
        });
        continue;
      }

      const value = Number(raw);
      const verdict = Number.isFinite(value) ? check.grade(value) : 'weak';
      settings.push({ name: check.name, value: raw, want: check.want, verdict });

      if (verdict === 'ok') continue;
      if (verdict === 'exposed') exposed += 1;
      else weak += 1;
      findings.push({
        severity: verdict === 'exposed' ? 'high' : 'medium',
        code: verdict === 'exposed' ? 'kernel.exposed' : 'kernel.weakened',
        message: `${check.name} is ${raw} (want ${check.want}): ${check.why}`,
        target: check.path,
      });
    }

    const checked = CHECKS.length - missing;
    const summary =
      findings.filter((finding) => finding.severity !== 'info').length === 0
        ? `all ${checked} readable settings are at their recommended value`
        : `${exposed} exposed and ${weak} weakened of ${checked} readable settings` +
          (missing > 0 ? ` (${missing} not exposed by this kernel)` : '');

    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary,
      findings,
      data: { settings },
      duration_ms: Date.now() - started,
    });
  },
};

/** Exposed for the tests: one setting's verdict, without a host to read. */
export function gradeSetting(name: string, value: number): Grade {
  const check = CHECKS.find((entry) => entry.name === name);
  if (check === undefined) throw new Error(`unknown setting '${name}'`);
  return check.grade(value);
}

export const HARDENING_CHECKS: readonly string[] = CHECKS.map((check) => check.name);

async function readOrUndefined(ctx: ToolRunContext, path: string): Promise<string | undefined> {
  try {
    const raw = await ctx.host.readTextFile(path);
    return raw.trim();
  } catch {
    return undefined;
  }
}
