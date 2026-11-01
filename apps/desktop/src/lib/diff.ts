/**
 * What changed between two reports of the same tool.
 *
 * Tables get row identity from their most identifying string column; objects are
 * compared key by key. Anything else is not comparable and says so, rather than
 * pretending an unchanged file is a change.
 */

export interface RowChange {
  kind: 'added' | 'removed' | 'changed';
  key: string;
  fields: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface DataDiff {
  changes: RowChange[];
  truncated: boolean;
}

const LIMIT = 200;
const IDENTITY = ['path', 'name', 'tool', 'id', 'filesystem', 'mount', 'user', 'source', 'code', 'label'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identity(row: Record<string, unknown>, index: number): string {
  for (const key of IDENTITY) {
    const value = row[key];
    if (typeof value === 'string' && value !== '') return `${key}:${value}`;
  }
  return `#${index}`;
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

function rows(before: unknown[], after: unknown[]): RowChange[] {
  const changes: RowChange[] = [];
  if (before.every(isRecord) && after.every(isRecord)) {
    const left = new Map(before.map((row, at) => [identity(row, at), row]));
    const right = new Map(after.map((row, at) => [identity(row, at), row]));
    for (const [key, row] of right) {
      const previous = left.get(key);
      if (!previous) {
        changes.push({ kind: 'added', key, fields: Object.keys(row), after: row });
        continue;
      }
      const fields = changedFields(previous, row);
      if (fields.length > 0) changes.push({ kind: 'changed', key, fields, before: previous, after: row });
    }
    for (const [key, row] of left) {
      if (!right.has(key)) changes.push({ kind: 'removed', key, fields: Object.keys(row), before: row });
    }
    return changes;
  }
  const left = new Set(before.map((row) => JSON.stringify(row)));
  const right = new Set(after.map((row) => JSON.stringify(row)));
  for (const row of right) if (!left.has(row)) changes.push({ kind: 'added', key: row, fields: [] });
  for (const row of left) if (!right.has(row)) changes.push({ kind: 'removed', key: row, fields: [] });
  return changes;
}

export function diffData(before: unknown, after: unknown): DataDiff {
  let changes: RowChange[] = [];
  if (Array.isArray(before) && Array.isArray(after)) {
    changes = rows(before, after);
  } else if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const left = before[key];
      const right = after[key];
      if (JSON.stringify(left) === JSON.stringify(right)) continue;
      const kind = left === undefined ? 'added' : right === undefined ? 'removed' : 'changed';
      changes.push({ kind, key, fields: [key], before: { [key]: left }, after: { [key]: right } });
    }
  }
  return { changes: changes.slice(0, LIMIT), truncated: changes.length > LIMIT };
}
