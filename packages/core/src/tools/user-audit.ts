/**
 * Local accounts, read the way an auditor reads them: who holds uid 0, whether
 * the password database is readable by the wrong people, which accounts have no
 * password, and where two accounts share an id.
 *
 * Read-only, and the password hashes never enter the report: only the account
 * and what is wrong with it.
 */

import { optString } from '../args.js';
import { notFound, toolFailed } from '../errors.js';
import { sealed, type Finding, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Shells that mean "this account cannot log in", including the empty field. */
export const NO_LOGIN_SHELLS = ['', '/bin/false', '/usr/bin/false', '/sbin/nologin', '/usr/sbin/nologin'];

export interface Account {
  name: string;
  uid: number;
  home: string;
  shell: string;
}

export interface UserRow {
  account: string;
  uid: number;
  shell: string;
  issue: string;
  severity: string;
}

const MANIFEST: ToolManifest = {
  id: 'sysadmin.user-audit',
  title: 'User audit',
  summary: 'uid 0 accounts, missing passwords, shadow permissions, duplicate ids',
  category: 'sysadmin',
  capabilities: ['fs:read'],
  args: [
    { name: 'passwd', type: 'path', default: '/etc/passwd', help: 'The account database to read' },
    { name: 'shadow', type: 'path', default: '/etc/shadow', help: 'The password database, when it can be read' },
  ],
  data: { shape: 'array', row: { account: 'string', uid: 'number', shell: 'string', issue: 'string', severity: 'string' } },
  tags: ['accounts', 'hardening', 'audit'],
  platforms: ['linux'],
};

/** `name:password:uid:gid:gecos:home:shell`, and a malformed line is skipped. */
export function parsePasswd(text: string): Account[] {
  const accounts: Account[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const fields = trimmed.split(':');
    if (fields.length < 7) continue;
    const [name, , uidText, , , home, shell] = fields;
    const uid = Number.parseInt(uidText ?? '', 10);
    if (name === undefined || name === '' || !Number.isFinite(uid)) continue;
    accounts.push({ name, uid, home: home ?? '', shell: shell ?? '' });
  }
  return accounts;
}

/** `name:hash:…` — the hash itself is returned so a caller can ask if it is empty. */
export function parseShadow(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(':');
    const [name, password] = parts;
    if (name === undefined || name === '' || password === undefined) continue;
    fields.set(name, password);
  }
  return fields;
}

function issue(account: Account, text: string, severity: string): UserRow {
  return { account: account.name, uid: account.uid, shell: account.shell, issue: text, severity };
}

export const userAudit: LocalTool = {
  manifest: MANIFEST,
  async run(ctx, args: Args): Promise<Report> {
    const started = Date.now();
    if (ctx.host.platform !== 'linux') {
      throw toolFailed('sysadmin.user-audit targets Linux: other systems keep accounts elsewhere');
    }

    const passwdPath = optString(args, 'passwd') ?? '/etc/passwd';
    const shadowPath = optString(args, 'shadow') ?? '/etc/shadow';
    if (!(await ctx.host.exists(passwdPath))) throw notFound(`${passwdPath} does not exist`);

    const accounts = parsePasswd(await ctx.host.readTextFile(passwdPath));
    const rows: UserRow[] = [];
    const findings: Finding[] = [];

    const byUid = new Map<number, Account[]>();
    for (const account of accounts) {
      byUid.set(account.uid, [...(byUid.get(account.uid) ?? []), account]);
    }

    for (const account of accounts) {
      if (account.uid === 0 && account.name !== 'root') {
        rows.push(issue(account, 'uid 0 account', 'critical'));
      }
      const shared = byUid.get(account.uid) ?? [];
      if (shared.length > 1) {
        const others = shared.filter((other) => other.name !== account.name).map((other) => other.name);
        rows.push(issue(account, `duplicate uid with ${others.join(', ')}`, 'medium'));
      }
      if (!NO_LOGIN_SHELLS.includes(account.shell) && account.home !== '' && !(await ctx.host.exists(account.home))) {
        rows.push(issue(account, 'missing home directory', 'low'));
      }
    }

    // The password database is where the sharp findings are, and it is usually
    // readable only by root: an unreadable file is reported, not guessed at.
    if (await ctx.host.exists(shadowPath)) {
      const mode = await ctx.host.mode(shadowPath);
      if (mode !== undefined && (mode & 0o004) !== 0) {
        findings.push({
          severity: 'critical',
          code: 'accounts.shadow-world-readable',
          message: `${shadowPath} is readable by every user (mode ${(mode & 0o7777).toString(8).padStart(3, '0')})`,
          target: shadowPath,
        });
      }

      let text: string | undefined;
      try {
        text = await ctx.host.readTextFile(shadowPath);
      } catch {
        findings.push({
          severity: 'info',
          code: 'accounts.shadow-unreadable',
          message: `${shadowPath} is not readable by this user; password checks need root`,
          target: shadowPath,
        });
      }

      if (text !== undefined) {
        const passwords = parseShadow(text);
        for (const account of accounts) {
          const password = passwords.get(account.name);
          if (password === '') rows.push(issue(account, 'account has no password', 'critical'));
        }
      }
    }

    rows.sort((left, right) => RANK[right.severity]! - RANK[left.severity]! || left.account.localeCompare(right.account));
    for (const row of rows) {
      findings.push({
        severity: row.severity as Finding['severity'],
        code: `accounts.${row.issue.replaceAll(' ', '-')}`,
        message: `${row.account} (uid ${row.uid}): ${row.issue}`,
        target: row.account,
      });
    }

    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary: `${accounts.length} account(s) checked, ${rows.length} issue(s)`,
      findings,
      data: rows,
      duration_ms: Date.now() - started,
    });
  },
};
