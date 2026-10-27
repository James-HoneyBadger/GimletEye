/**
 * Audit trail, one JSON object per line, capped at a fixed number of entries.
 *
 * Argument *names* are recorded, never values, so a passphrase or a file's
 * contents cannot leak into the trail. A run that failed is still a run: leaving
 * it out would make repeated failures — a wrong passphrase guessed at, for
 * instance — the one thing the trail does not show.
 *
 * Every write goes through a sibling temporary file and a rename. Appending in
 * place would be faster, but two surfaces running at once can then interleave a
 * partial line into the trail, and a trail that cannot be parsed is worse than
 * one that is a few milliseconds slower.
 */

import { GimletError } from './errors.js';
import { join } from './pathutil.js';
import type { Status } from './report.js';
import type { Host } from './host.js';

export interface AuditEntry {
  ts: string;
  tool: string;
  status: Status;
  duration_ms: number;
  arg_keys?: string[];
}

export function auditEntry(tool: string, status: Status, durationMs: number, argKeys: string[] = []): AuditEntry {
  return {
    ts: rfc3339(new Date()),
    tool,
    status,
    duration_ms: durationMs,
    ...(argKeys.length === 0 ? {} : { arg_keys: argKeys }),
  };
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
    await this.host.createDir(parentOf(this.path));
    const existing = await this.readAll();
    existing.push(entry);
    await this.writeAll(prune(existing, this.maxEntries));
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
    const temporary = join(parentOf(this.path), `.${'audit'}.${processStamp()}.tmp`);
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
  return maxEntries > 0 && entries.length > maxEntries ? entries.slice(entries.length - maxEntries) : entries;
}

function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '.' : path.slice(0, at);
}

function processStamp(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
