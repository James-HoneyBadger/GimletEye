/**
 * Audit trail, one JSON object per line, capped at a fixed number of entries.
 *
 * Argument *names* are recorded, never values, so a passphrase or a file's
 * contents cannot leak into the trail. A run that failed is still a run: leaving
 * it out would make repeated failures — a wrong passphrase guessed at, for
 * instance — the one thing the trail does not show.
 *
 * A run is appended as one line, which is atomic: two surfaces running at once
 * each keep their record. This used to read the whole trail, add a line, and
 * rewrite it through a rename — which lost updates outright. Twenty parallel
 * runs left sixteen records, and the trail is precisely the file where a missing
 * entry matters.
 *
 * The cap is still exact, but it is enforced by trimming only when a run takes
 * the trail past it: the append is the write, and the read that decides whether
 * to trim never blocks another process's append. Trimming is a read-modify-write,
 * so two processes trimming at the same instant can drop an entry — it happens
 * once per `max_entries` runs rather than on every one, and a lock file would
 * bring its own failure mode.
 */

import { GimletError } from './errors.js';
import { dirname, join } from './pathutil.js';
import type { Status } from './report.js';
import type { Host } from './host.js';

export interface AuditEntry {
  ts: string;
  tool: string;
  status: Status;
  duration_ms: number;
  arg_keys?: string[];
  run_id?: string;
  dry_run?: boolean;
  run_index?: number;
  run_count?: number;
}

export interface AuditContext {
  runId?: string;
  dryRun?: boolean;
  runIndex?: number;
  runCount?: number;
}

let runSequence = 0;

export function newRunId(): string {
  runSequence += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${runSequence.toString(36)}`;
}

export function auditEntry(
  tool: string,
  status: Status,
  durationMs: number,
  argKeys: string[] = [],
  context: AuditContext = {},
): AuditEntry {
  return {
    ts: rfc3339(new Date()),
    tool,
    status,
    duration_ms: durationMs,
    ...(argKeys.length === 0 ? {} : { arg_keys: argKeys }),
    run_id: context.runId ?? newRunId(),
    dry_run: context.dryRun ?? false,
    ...(context.runIndex === undefined ? {} : { run_index: context.runIndex }),
    ...(context.runCount === undefined ? {} : { run_count: context.runCount }),
  };
}

export interface AuditSummary {
  /** The newest run of each tool, with how many times it ran in the window read. */
  latest: Map<string, { ts: string; status: Status; runs: number }>;
  /** How many entries of each verdict. */
  counts: Record<Status, number>;
}

/**
 * Reduce a tail of the trail to "what last happened, and how often".
 *
 * Read-only and order-independent: a trail read newest-first and one read
 * oldest-first produce the same answer, which is what lets a UI and a CLI share
 * it without agreeing on how they read the file.
 */
export function summariseAudit(entries: readonly AuditEntry[]): AuditSummary {
  const latest = new Map<string, { ts: string; status: Status; runs: number }>();
  const runsByTool = new Map<string, Set<string>>();
  const counts: Record<Status, number> = { ok: 0, warning: 0, error: 0 };
  entries.forEach((entry, index) => {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    const runs = runsByTool.get(entry.tool) ?? new Set<string>();
    runs.add(entry.run_id ?? `legacy:${index}`);
    runsByTool.set(entry.tool, runs);
    const seen = latest.get(entry.tool);
    // RFC 3339 sorts as a string, so no date arithmetic is needed.
    if (!seen || entry.ts > seen.ts) latest.set(entry.tool, { ts: entry.ts, status: entry.status, runs: runs.size });
    else latest.set(entry.tool, { ts: seen.ts, status: seen.status, runs: runs.size });
  });
  return { latest, counts };
}

/** Current time as RFC 3339 UTC with second precision, e.g. `2026-10-23T16:28:42Z`. */
export function rfc3339(time: Date): string {
  return `${time.toISOString().slice(0, 19)}Z`;
}

export class AuditLog {
  constructor(
    private readonly host: Host,
    readonly path: string,
    private readonly maxEntries: number,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.host.createDir(dirname(this.path));
    await this.host.appendTextFile(this.path, `${JSON.stringify(entry)}\n`);
    await this.trimIfLarge();
  }

  /** Rewrite the trail only when a run has taken it past the cap. */
  private async trimIfLarge(): Promise<void> {
    if (this.maxEntries <= 0) return;
    const entries = await this.readAll();
    if (runGroupCount(entries) <= this.maxEntries) return;
    await this.writeAll(prune(entries, this.maxEntries));
  }

  /** Most recent entries first, up to `limit`. */
  async tail(limit: number): Promise<AuditEntry[]> {
    const entries = await this.readAll();
    return entries.reverse().slice(0, limit);
  }

  async readAll(): Promise<AuditEntry[]> {
    if (!(await this.host.exists(this.path))) return [];
    const raw = await this.host.readTextFile(this.path);
    const entries: AuditEntry[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // A malformed line is skipped, not fatal: one bad write must not hide
        // every record around it.
      }
    }
    return entries;
  }

  /**
   * Replace the trail through a sibling file and a rename, so a reader never
   * observes a half-rewritten trail.
   */
  private async writeAll(entries: readonly AuditEntry[]): Promise<void> {
    const temporary = join(dirname(this.path), `.${'audit'}.${processStamp()}.tmp`);
    const body = entries.map((entry) => JSON.stringify(entry)).join('\n');
    await this.host.writeTextFile(temporary, body === '' ? '' : `${body}\n`);
    try {
      await this.host.rename(temporary, this.path);
    } catch (error) {
      await this.host.removeTree(temporary);
      throw error instanceof GimletError ? error : new GimletError('io', String(error));
    }
  }
}

function prune(entries: AuditEntry[], maxEntries: number): AuditEntry[] {
  if (maxEntries <= 0) return entries;

  const latestIndex = new Map<string, number>();
  entries.forEach((entry, index) => latestIndex.set(groupKey(entry, index), index));
  if (latestIndex.size <= maxEntries) return entries;

  const retained = new Set(
    [...latestIndex.entries()]
      .sort((left, right) => left[1] - right[1])
      .slice(-maxEntries)
      .map(([key]) => key),
  );
  return entries.filter((entry, index) => retained.has(groupKey(entry, index)));
}

function runGroupCount(entries: readonly AuditEntry[]): number {
  return new Set(entries.map(groupKey)).size;
}

function groupKey(entry: AuditEntry, index: number): string {
  return entry.run_id === undefined ? `legacy:${index}` : `run:${entry.run_id}`;
}

function processStamp(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
