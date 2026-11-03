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
import type { DataField, DataFieldSpec, DataSpec, ToolManifest } from './manifest.js';

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
  return spec.split('|').includes(kind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueProblems(where: string, spec: DataFieldSpec, value: unknown): string[] {
  if (typeof spec === 'string') {
    return accepts(spec, value) ? [] : [`${where} should be ${spec} but is ${kindOf(value)}`];
  }

  if (spec.shape === 'object') {
    if (!isRecord(value)) return [`${where} should be an object but is ${kindOf(value)}`];
    return checkFields(where, value, spec.required, spec.optional);
  }

  if (!Array.isArray(value)) return [`${where} should be an array but is ${kindOf(value)}`];
  if (spec.row !== undefined) {
    return value.flatMap((row, index) =>
      isRecord(row)
        ? checkFields(`${where}[${index}]`, row, spec.row!, undefined)
        : [`${where}[${index}] should be an object but is ${kindOf(row)}`],
    );
  }
  if (spec.items !== undefined) {
    return value.flatMap((item, index) => valueProblems(`${where}[${index}]`, spec.items!, item));
  }
  return [];
}

function checkFields(
  where: string,
  fields: Record<string, unknown>,
  declared: Record<string, DataFieldSpec>,
  optional: Record<string, DataFieldSpec> | undefined,
): string[] {
  const problems: string[] = [];
  for (const [key, spec] of Object.entries(declared)) {
    if (!Object.hasOwn(fields, key)) {
      problems.push(`${where}.${key} is declared but missing`);
      continue;
    }
    problems.push(...valueProblems(`${where}.${key}`, spec, fields[key]));
  }
  for (const [key, spec] of Object.entries(optional ?? {})) {
    // Absent is fine; present with the wrong type is not.
    if (Object.hasOwn(fields, key)) {
      problems.push(...valueProblems(`${where}.${key}`, spec, fields[key]));
    }
  }
  for (const key of Object.keys(fields)) {
    if (!Object.hasOwn(declared, key) && !(optional !== undefined && Object.hasOwn(optional, key))) {
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

  return valueProblems('data', spec, data);
}

/** Throw when a report does not match the schema its own manifest declares. */
export function assertDataShape(manifest: ToolManifest, data: unknown): void {
  const problems = dataProblems(manifest, data);
  if (problems.length > 0) {
    throw internal(`${manifest.id} reported data that does not match its schema: ${problems.join('; ')}`);
  }
}
