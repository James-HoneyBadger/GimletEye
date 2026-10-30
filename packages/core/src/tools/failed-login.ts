/**
 * Repeated authentication failures, counted from a text auth log.
 *
 * File-based on purpose: journald would mean running `journalctl`, and the only
 * external processes the built-in tools run are `df` and `gpg`. A host that logs
 * only to the journal gets a finding saying so rather than a silent zero.
 */

import { integerOr, optString } from '../args.js';
import { invalidArgs, notFound, unsupported } from '../errors.js';
import { sealed, type Finding, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

/** Where Debian and Red Hat systems keep the file by default. */
export const AUTH_LOGS = ['/var/log/auth.log', '/var/log/secure'];

const FAILED = /Failed (?:password|publickey|keyboard-interactive\/pam) for (?:invalid user )?(\S+) from (\S+)/;
const PAM = /authentication failure;.*?\buser=(\S+)/;

export interface AttemptRow {
  user: string;
  source: string;
  attempts: number;
}

const MANIFEST: ToolManifest = {
  id: 'sysadmin.failed-login-detector',
  title: 'Failed logins',
  summary: 'Repeated authentication failures, grouped by account and source',
  category: 'sysadmin',
  capabilities: ['fs:read'],
  args: [
    { name: 'log', type: 'path', help: 'Auth log to read (default: /var/log/auth.log, then /var/log/secure)' },
    { name: 'threshold', type: 'integer', default: 5, help: 'Report a pair at this many failures' },
    { name: 'limit', type: 'integer', default: 20, help: 'Rows to report, worst first' },
  ],
  data: { shape: 'array', row: { user: 'string', source: 'string', attempts: 'number' } },
  tags: ['accounts', 'brute-force', 'log'],
  platforms: ['linux'],
};

/**
 * One failure per line. `sshd` writes both an `Invalid user` line and a
 * `Failed password for invalid user` line for the same attempt, so only the
 * second is counted; counting both would double every enumeration.
 */
export function parseFailures(text: string): Map<string, AttemptRow> {
  const counts = new Map<string, AttemptRow>();
  for (const line of text.split('\n')) {
    const failed = FAILED.exec(line);
    const pam = failed === null ? PAM.exec(line) : null;
    const user = failed?.[1] ?? pam?.[1];
    if (user === undefined) continue;
    const source = failed?.[2] ?? 'local';
    const key = `${user}\u0000${source}`;
    const seen = counts.get(key);
    if (seen === undefined) counts.set(key, { user, source, attempts: 1 });
    else seen.attempts += 1;
  }
  return counts;
}

async function authLog(ctx: ToolRunContext, requested: string | undefined): Promise<string | undefined> {
  if (requested !== undefined) {
    if (!(await ctx.host.exists(requested))) throw notFound(`${requested} does not exist`);
    return requested;
  }
  for (const candidate of AUTH_LOGS) {
    if (await ctx.host.exists(candidate)) return candidate;
  }
  return undefined;
}

export const failedLoginDetector: LocalTool = {
  manifest: MANIFEST,
  async run(ctx, args: Args): Promise<Report> {
    const started = Date.now();
    if (ctx.host.platform !== 'linux') {
      throw unsupported('sysadmin.failed-login-detector targets Linux auth logs');
    }

    const threshold = integerOr(args, 'threshold', 5);
    const limit = integerOr(args, 'limit', 20);
    if (threshold < 1) throw invalidArgs('threshold must be at least 1');
    if (limit < 1) throw invalidArgs('limit must be at least 1');

    const log = await authLog(ctx, optString(args, 'log'));
    if (log === undefined) {
      return sealed({
        tool: MANIFEST.id,
        status: 'ok',
        summary: 'no auth log found; nothing counted',
        findings: [
          {
            severity: 'info',
            code: 'login.no-auth-log',
            message: `none of ${AUTH_LOGS.join(', ')} exists; a host that logs only to journald is not read by this tool`,
          },
        ],
        data: [],
        duration_ms: Date.now() - started,
      });
    }

    const counts = parseFailures(await ctx.host.readTextFile(log));
    const all = [...counts.values()].sort((left, right) => right.attempts - left.attempts || left.user.localeCompare(right.user));
    const rows = all.slice(0, limit);

    const findings: Finding[] = rows
      .filter((row) => row.attempts >= threshold)
      .map((row) => ({
        severity: 'high' as const,
        code: 'login.repeated-failure',
        message: `${row.user} from ${row.source}: ${row.attempts} failure(s) in ${log}`,
        target: row.source,
      }));

    const total = all.reduce((sum, row) => sum + row.attempts, 0);
    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary:
        `${total} failure(s) from ${all.length} account/source pair(s) in ${log}` +
        (threshold > 1 ? `, ${findings.length} at or above ${threshold}` : ''),
      findings,
      data: rows,
      duration_ms: Date.now() - started,
    });
  },
};
