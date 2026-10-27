/**
 * The declared shape of `Report.data`, and the check that keeps it honest.
 *
 * ADR 0006 Gate 3: a consumer must be able to parse a report without
 * reverse-engineering it. A schema nobody checks is a comment, so this runs on
 * every report the runtime returns — a tool that adds a field, drops one, or
 * changes a type fails its own test rather than surprising a script.
 *
 * The schemas themselves came from running each tool and recording what it
 * produced (`scripts/tool-reference.py --data-schema`), then adding `null` where
 * a dry run legitimately returns nothing.
 */

import { internal } from './errors.js';
import type { DataField, DataSpec, ToolManifest } from './manifest.js';

export function kindOf(value: unknown): DataField {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'unknown';
  }
}

function accepts(spec: string, value: unknown): boolean {
  const kind = kindOf(value);
  if (kind === 'unknown' || spec === 'unknown') return spec === 'unknown' || kind === 'unknown';
  return spec.split('|').includes(kind);
}

function checkFields(
  where: string,
  fields: Record<string, unknown>,
  declared: Record<string, string>,
  optional: Record<string, string> | undefined,
  required: boolean,
): string[] {
  const problems: string[] = [];
  for (const [key, spec] of Object.entries(declared)) {
    if (!(key in fields)) {
      if (required) problems.push(`${where}.${key} is declared but missing`);
      continue;
    }
    if (!accepts(spec, fields[key])) {
      problems.push(`${where}.${key} should be ${spec} but is ${kindOf(fields[key])}`);
    }
  }
  for (const [key, spec] of Object.entries(optional ?? {})) {
    // Absent is fine; present with the wrong type is not.
    if (key in fields && !accepts(spec, fields[key])) {
      problems.push(`${where}.${key} should be ${spec} but is ${kindOf(fields[key])}`);
    }
  }
  for (const key of Object.keys(fields)) {
    if (!(key in declared) && !(optional !== undefined && key in optional)) {
      problems.push(`${where}.${key} is not in the declared schema`);
    }
  }
  return problems;
}

/**
 * The ways `data` disagrees with the manifest.
 *
 * A manifest with no `data` declares nothing and is not checked — that is what
 * lets a tool be written before its shape settles, and `data-schema.test.ts`
 * holds the shipped tools to having one.
 */
export function dataProblems(manifest: ToolManifest, data: unknown): string[] {
  const spec: DataSpec | undefined = manifest.data;
  if (spec === undefined) return [];

  if (spec.shape === 'array') {
    if (!Array.isArray(data)) return [`data should be an array but is ${kindOf(data)}`];
    if (spec.row === undefined) return [];
    return data.flatMap((row, index) =>
      row === null || typeof row !== 'object' || Array.isArray(row)
        ? [`data[${index}] should be an object but is ${kindOf(row)}`]
        : checkFields(`data[${index}]`, row as Record<string, unknown>, spec.row!, undefined, true),
    );
  }

  if (Array.isArray(data) || data === null || typeof data !== 'object') {
    return [`data should be an object but is ${kindOf(data)}`];
  }
  return checkFields('data', data as Record<string, unknown>, spec.required, spec.optional, true);
}

/** Throw when a report does not match the schema its own manifest declares. */
export function assertDataShape(manifest: ToolManifest, data: unknown): void {
  const problems = dataProblems(manifest, data);
  if (problems.length > 0) {
    throw internal(`${manifest.id} reported data that does not match its schema: ${problems.join('; ')}`);
  }
}
