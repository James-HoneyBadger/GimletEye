/**
 * The argument gate every surface passes through.
 *
 * Coercion turned text into typed values; this decides whether those values are
 * the ones the tool declared. It lives once, in the runtime, because the CLI,
 * the TUI, batch, the desktop bridge, and the optional engine all arrive here —
 * and because a misspelled `in_place` or `overwrite` otherwise changes what a
 * destructive tool does without saying anything.
 *
 * The rules mirror the readers in `args.ts` on purpose: a string of digits is an
 * integer only when it survives a round trip, and a boolean may arrive as text
 * because `coerce` leaves `true`/`false` typed but a sidecar may not.
 */

import { invalidArgs } from './errors.js';
import type { ArgSpec, ToolManifest } from './manifest.js';
import type { Args, ArgValue } from './args.js';

const BOOLEAN_TEXT = /^(true|false|yes|no|1|0)$/i;

/** Everything wrong with `args` for `manifest`, in a stable order. */
export function argProblems(manifest: ToolManifest, args: Args): string[] {
  const declared = new Map<string, ArgSpec>((manifest.args ?? []).map((spec) => [spec.name, spec]));
  const problems: string[] = [];

  for (const name of Object.keys(args).sort()) {
    if (!declared.has(name)) problems.push(`unknown argument '${name}'`);
  }

  for (const spec of declared.values()) {
    const value = args[spec.name];
    if (missing(value)) {
      if (spec.required === true) problems.push(`missing required argument '${spec.name}'`);
      continue;
    }
    const problem = typeProblem(spec, value as ArgValue);
    if (problem !== undefined) problems.push(`argument '${spec.name}' ${problem}`);
  }

  return problems;
}

/** Throw the one usage error every surface shows. */
export function validateRun(manifest: ToolManifest, args: Args): void {
  const problems = argProblems(manifest, args);
  if (problems.length > 0) throw invalidArgs(problems.join('; '));
}

function missing(value: ArgValue | undefined): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function typeProblem(spec: ArgSpec, value: ArgValue): string | undefined {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean' || (typeof value === 'string' && BOOLEAN_TEXT.test(value))
        ? undefined
        : 'must be a boolean';
    case 'integer':
      return nonNegativeInteger(value) ? undefined : 'must be a non-negative integer';
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value)
        ? undefined
        : `must be one of: ${spec.values.join(', ')}`;
    case 'path':
      return typeof value === 'string' ? undefined : 'must be a path';
    case 'string':
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? undefined
        : 'must be a string';
  }
}

function nonNegativeInteger(value: ArgValue): boolean {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return false;
  return Number.isSafeInteger(Number(value));
}
