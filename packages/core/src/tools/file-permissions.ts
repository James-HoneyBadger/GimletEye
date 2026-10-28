/**
 * Permission hazards under a path: entries anyone may write, and the setuid and
 * setgid bits on files that carry them.
 *
 * Read-only and depth-capped. Links are not followed: the tree being audited is
 * the tree that was named, and a link's target lives somewhere else.
 */

import { booleanOr, integerOr, optString } from '../args.js';
import { invalidArgs, notFound, toolFailed } from '../errors.js';
import { join } from '../pathutil.js';
import { sealed, type Finding, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

const SETUID = 0o4000;
const SETGID = 0o2000;
const STICKY = 0o1000;
const WORLD_WRITABLE = 0o002;
const GROUP_WRITABLE = 0o020;

const RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export interface PermissionRow {
  path: string;
  mode: string;
  issue: string;
  severity: string;
}

export interface PermissionIssue {
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

const MANIFEST: ToolManifest = {
  id: 'sysadmin.file-permissions',
  title: 'File permissions',
  summary: 'Entries anyone may write, and setuid or setgid files, under a path',
  category: 'sysadmin',
  capabilities: ['fs:read'],
  args: [
    { name: 'path', type: 'path', default: '.', help: 'Root of the scan' },
    { name: 'max_depth', type: 'integer', default: 4, help: 'How many directories to descend' },
    { name: 'max_entries', type: 'integer', default: 20000, help: 'Stop after this many entries' },
    { name: 'group_writable', type: 'boolean', default: false, help: 'Also report group-writable entries' },
  ],
  data: { shape: 'array', row: { path: 'string', mode: 'string', issue: 'string', severity: 'string' } },
  tags: ['permissions', 'hardening', 'filesystem'],
  platforms: ['linux', 'macos'],
};

/** `0o4755` becomes `4755`: the same four digits `ls` shows, without the type. */
export function describeMode(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

/** What is wrong with one entry, given its bits and whether it is a directory. */
export function issuesFor(mode: number, isDirectory: boolean, groupWritable: boolean): PermissionIssue[] {
  const issues: PermissionIssue[] = [];
  const what = isDirectory ? 'directory' : 'file';
  const worldWritable = (mode & WORLD_WRITABLE) !== 0;
  const elevated = (mode & (SETUID | SETGID)) !== 0;

  if (elevated) {
    const bits = (mode & SETUID) !== 0 ? 'setuid' : 'setgid';
    // Anyone who may write a file may replace it, so an elevated bit on a
    // world-writable entry is the escalation rather than just the bit.
    issues.push({
      issue: worldWritable ? `world-writable ${bits} ${what}` : `${bits} ${what}`,
      severity: worldWritable ? 'critical' : 'medium',
    });
  } else if (worldWritable && !(isDirectory && (mode & STICKY) !== 0)) {
    // A sticky world-writable directory is how `/tmp` works, and reporting it
    // would bury the findings that matter.
    issues.push({ issue: `world-writable ${what}`, severity: isDirectory ? 'high' : 'medium' });
  }

  if (groupWritable && (mode & GROUP_WRITABLE) !== 0) {
    issues.push({ issue: `group-writable ${what}`, severity: 'low' });
  }

  return issues;
}

interface Entry {
  path: string;
  mode: number;
  isDirectory: boolean;
}

async function walk(
  ctx: ToolRunContext,
  root: string,
  maxDepth: number,
  maxEntries: number,
): Promise<{ entries: Entry[]; truncated: boolean }> {
  const entries: Entry[] = [];
  const stack: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  let truncated = false;

  while (stack.length > 0) {
    const current = stack.pop()!;
    let stat;
    try {
      stat = await ctx.host.stat(current.path);
    } catch {
      continue;
    }
    const mode = await ctx.host.mode(current.path);
    if (mode !== undefined) {
      entries.push({ path: current.path, mode, isDirectory: stat.isDirectory });
      if (entries.length >= maxEntries) {
        truncated = stack.length > 0;
        break;
      }
    }
    if (!stat.isDirectory || current.depth >= maxDepth) continue;

    let names: string[];
    try {
      names = await ctx.host.readDir(current.path);
    } catch {
      continue;
    }
    for (const name of [...names].sort()) {
      stack.push({ path: join(current.path, name), depth: current.depth + 1 });
    }
  }

  return { entries, truncated };
}

export const filePermissions: LocalTool = {
  manifest: MANIFEST,
  async run(ctx, args: Args): Promise<Report> {
    const started = Date.now();
    if (ctx.host.platform === 'windows') {
      throw toolFailed('sysadmin.file-permissions targets Linux and macOS: Windows has no mode bits');
    }

    const root = optString(args, 'path') ?? '.';
    const maxDepth = integerOr(args, 'max_depth', 4);
    const maxEntries = integerOr(args, 'max_entries', 20000);
    const groupWritable = booleanOr(args, 'group_writable', false);
    if (maxDepth < 0) throw invalidArgs('max_depth must be zero or more');
    if (maxEntries < 1) throw invalidArgs('max_entries must be at least 1');
    if (!(await ctx.host.exists(root))) throw notFound(`${root} does not exist`);

    const { entries, truncated } = await walk(ctx, root, maxDepth, maxEntries);

    const rows: PermissionRow[] = [];
    for (const entry of entries) {
      for (const found of issuesFor(entry.mode, entry.isDirectory, groupWritable)) {
        rows.push({
          path: entry.path,
          mode: describeMode(entry.mode),
          issue: found.issue,
          severity: found.severity,
        });
      }
    }
    rows.sort((left, right) => RANK[right.severity]! - RANK[left.severity]! || left.path.localeCompare(right.path));

    const findings: Finding[] = rows.map((row) => ({
      severity: row.severity as Finding['severity'],
      code: `permissions.${row.issue.replaceAll(' ', '-')}`,
      message: `${row.path} is ${row.issue} (mode ${row.mode})`,
      target: row.path,
    }));

    const scanned = `${entries.length} entries scanned`;
    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary:
        truncated
          ? `${scanned} (stopped at max_entries), ${rows.length} issue(s)`
          : `${scanned}, ${rows.length} issue(s)`,
      findings,
      data: rows,
      duration_ms: Date.now() - started,
    });
  },
};
