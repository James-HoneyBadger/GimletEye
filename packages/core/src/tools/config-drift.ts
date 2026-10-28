/**
 * Configuration drift: record what a tree looks like, then say what changed.
 *
 * The snapshot is a map of path to SHA-256 under `$GIMLET_HOME/data/drift`, so a
 * run of `cron`-driven configuration can be checked without keeping a copy of
 * every file: a hash is enough to notice that something moved.
 */

import { sha256Hex } from '@gimlet-eye/engine';

import { booleanOr, integerOr, optString, stringOr } from '../args.js';
import { invalidArgs, notFound, toolFailed } from '../errors.js';
import { join } from '../pathutil.js';
import { sealed, type Finding, type Report } from '../report.js';
import type { Args } from '../args.js';
import type { LocalTool, ToolRunContext } from '../local.js';
import type { ToolManifest } from '../manifest.js';

export interface DriftRow {
  path: string;
  change: string;
  before: string;
  after: string;
}

interface Snapshot {
  version: 1;
  root: string;
  files: Record<string, string>;
}

const MANIFEST: ToolManifest = {
  id: 'sysadmin.config-drift',
  title: 'Configuration drift',
  summary: 'Snapshot file hashes under a path and report what changed since',
  category: 'sysadmin',
  capabilities: ['fs:read', 'fs:write'],
  mutates: true,
  args: [
    { name: 'input', type: 'path', required: true, help: 'File or directory to watch' },
    { name: 'name', type: 'string', default: 'default', help: 'Which snapshot to compare against' },
    { name: 'snapshot', type: 'boolean', default: false, help: 'Replace the snapshot with what is there now' },
    { name: 'max_depth', type: 'integer', default: 6, help: 'How many directories to descend' },
    { name: 'max_entries', type: 'integer', default: 5000, help: 'Stop after this many files' },
  ],
  data: { shape: 'array', row: { path: 'string', change: 'string', before: 'string', after: 'string' } },
  tags: ['config', 'drift', 'integrity'],
  platforms: ['linux', 'macos'],
};

/** A snapshot name becomes a file name, so it may not walk out of its directory. */
export function snapshotName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw invalidArgs(`name '${value}' may only contain letters, digits, dot, dash, and underscore`);
  }
  return value;
}

async function hashTree(
  ctx: ToolRunContext,
  root: string,
  maxDepth: number,
  maxEntries: number,
): Promise<{ files: Map<string, string>; truncated: boolean }> {
  const files = new Map<string, string>();
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

    if (stat.isFile) {
      if (files.size >= maxEntries) {
        truncated = true;
        break;
      }
      files.set(current.path, sha256Hex(await ctx.host.readFile(current.path)));
      continue;
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

  return { files, truncated };
}

async function readSnapshot(ctx: ToolRunContext, path: string): Promise<Snapshot> {
  let text: string;
  try {
    text = await ctx.host.readTextFile(path);
  } catch {
    throw notFound(`${path} does not exist; run the same command with snapshot=true first`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw toolFailed(`${path} is not a snapshot this tool wrote`);
  }
  const snapshot = parsed as Partial<Snapshot>;
  if (snapshot.version !== 1 || typeof snapshot.files !== 'object' || snapshot.files === null) {
    throw toolFailed(`${path} is not a snapshot this tool wrote`);
  }
  return { version: 1, root: String(snapshot.root ?? ''), files: snapshot.files as Record<string, string> };
}

export const configDrift: LocalTool = {
  manifest: MANIFEST,
  async run(ctx, args: Args): Promise<Report> {
    const started = Date.now();
    const root = optString(args, 'input');
    if (root === undefined) throw invalidArgs("'input' is required: the file or directory to watch");
    if (!(await ctx.host.exists(root))) throw notFound(`${root} does not exist`);

    const name = snapshotName(stringOr(args, 'name', 'default'));
    const snapshotArg = booleanOr(args, 'snapshot', false);
    const maxDepth = integerOr(args, 'max_depth', 6);
    const maxEntries = integerOr(args, 'max_entries', 5000);
    if (maxDepth < 0) throw invalidArgs('max_depth must be zero or more');
    if (maxEntries < 1) throw invalidArgs('max_entries must be at least 1');

    const snapshotPath = join(ctx.paths.dataDir, 'drift', `${name}.json`);
    const current = await hashTree(ctx, root, maxDepth, maxEntries);
    const findings: Finding[] = [];
    if (current.truncated) {
      findings.push({
        severity: 'info',
        code: 'drift.truncated',
        message: `stopped after ${maxEntries} files; raise max_entries to cover the whole tree`,
        target: root,
      });
    }

    if (snapshotArg) {
      const snapshot: Snapshot = { version: 1, root, files: Object.fromEntries([...current.files].sort()) };
      if (ctx.dryRun) {
        return sealed({
          tool: MANIFEST.id,
          status: 'ok',
          summary: `would record ${current.files.size} file(s) as snapshot '${name}'`,
          findings,
          data: [],
          duration_ms: Date.now() - started,
        });
      }
      await ctx.host.createDir(join(ctx.paths.dataDir, 'drift'));
      await ctx.host.writeTextFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      return sealed({
        tool: MANIFEST.id,
        status: 'ok',
        summary: `recorded ${current.files.size} file(s) as snapshot '${name}'`,
        findings,
        data: [],
        duration_ms: Date.now() - started,
      });
    }

    const baseline = await readSnapshot(ctx, snapshotPath);
    const rows: DriftRow[] = [];
    for (const [path, digest] of current.files) {
      const before = baseline.files[path];
      if (before === undefined) rows.push({ path, change: 'added', before: '', after: digest });
      else if (before !== digest) rows.push({ path, change: 'changed', before, after: digest });
    }
    for (const [path, digest] of Object.entries(baseline.files)) {
      if (!current.files.has(path)) rows.push({ path, change: 'removed', before: digest, after: '' });
    }
    rows.sort((left, right) => left.path.localeCompare(right.path));

    for (const row of rows) {
      findings.push({
        severity: 'medium',
        code: `drift.${row.change}`,
        message: `${row.path} was ${row.change} since snapshot '${name}'`,
        target: row.path,
      });
    }

    const count = (change: string): number => rows.filter((row) => row.change === change).length;
    return sealed({
      tool: MANIFEST.id,
      status: 'ok',
      summary:
        `${count('added')} added, ${count('removed')} removed, ${count('changed')} changed ` +
        `across ${current.files.size} file(s) since snapshot '${name}'`,
      findings,
      data: rows,
      duration_ms: Date.now() - started,
    });
  },
};
