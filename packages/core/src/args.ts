/**
 * The untyped argument bag every surface normalizes into.
 *
 * A tool receives names and JSON values, never a string it has to re-parse:
 * `k=v` on the command line, a form in the desktop app, and the sidecar's JSON
 * all arrive here first.
 */

import { invalidArgs } from './errors.js';

export type ArgValue = string | number | boolean | null;
export type Args = Record<string, ArgValue>;

/**
 * Parse `key=value` pairs from a command line.
 *
 * Only text that survives a round trip is coerced: `true`/`false` and canonical
 * integers become typed values. Everything else stays a string — `0123`, `+5`,
 * and `-0` are what the user typed, and rewriting them would silently change a
 * passphrase, a PIN, or a file name.
 */
export function fromPairs(rawArgs: readonly string[]): Args {
  const args: Args = {};
  for (const raw of rawArgs) {
    const at = raw.indexOf('=');
    if (at < 0) {
      throw invalidArgs(`argument '${raw}' must be key=value (for example length=32)`);
    }
    const key = raw.slice(0, at);
    const value = raw.slice(at + 1);
    if (key === '') throw invalidArgs('empty argument name');
    args[key] = coerce(value);
  }
  return args;
}

export function coerce(raw: string): ArgValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?(0|[1-9]\d*)$/.test(raw)) {
    const number = Number(raw);
    if (Number.isSafeInteger(number) && String(number) === raw) return number;
  }
  return raw;
}

/**
 * Does this argument name carry a secret value?
 *
 * A surface uses this to mask the input, keep the value out of anything it
 * prints or copies, and leave it out of a saved draft. It is a name heuristic on
 * purpose: until `ArgSpec` can declare `secret: true`, the name is the only
 * signal a manifest gives — and every tool that takes a passphrase already calls
 * it one.
 */
const SECRET_ARG_NAME = /(^|_)(passphrase|password|secret|token|pin)($|_)/i;

export function isSecretArg(name: string): boolean {
  // `passphrase_env` names an environment variable; the variable's *name* is not
  // the secret, and hiding it would make the copied command useless.
  if (/(^|_)env$/i.test(name)) return false;
  return SECRET_ARG_NAME.test(name);
}

export function optString(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw invalidArgs(`argument '${key}' must be a string`);
}

export function stringOr(args: Args, key: string, fallback: string): string {
  return optString(args, key) ?? fallback;
}

export function requireString(args: Args, key: string): string {
  const value = optString(args, key);
  if (value === undefined) throw invalidArgs(`missing required argument '${key}'`);
  return value;
}

export function optBoolean(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case '1':
        return true;
      case 'false':
      case 'no':
      case '0':
        return false;
    }
  }
  throw invalidArgs(`argument '${key}' must be a boolean`);
}

export function booleanOr(args: Args, key: string, fallback: boolean): boolean {
  return optBoolean(args, key) ?? fallback;
}

export function optInteger(args: Args, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    // A digit string beyond 2^53 is not a number any tool can act on; `coerce`
    // already refuses to invent one, so this must not either.
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  throw invalidArgs(`argument '${key}' must be a non-negative integer`);
}

export function integerOr(args: Args, key: string, fallback: number): number {
  return optInteger(args, key) ?? fallback;
}
