/**
 * Command-line parsing.
 *
 * Hand-rolled rather than generated: the surface is small, every flag is
 * documented in `docs/COMPATIBILITY.md`, and `scripts/check-public-surface.sh`
 * compares that table with `--help`. A parse error names the token that was
 * wrong instead of printing a usage wall.
 */

import { invalidArgs } from '@gimlet-eye/core';
import type { OutputFormat } from '@gimlet-eye/core';

export interface Globals {
  home: string | undefined;
  format: OutputFormat | undefined;
  /** Redirect the report here instead of stdout. */
  output: string | undefined;
  /** Nothing on stdout; the exit status is the answer. */
  quiet: boolean;
  dryRun: boolean;
  strict: boolean;
  verbose: number;
}

export type Command =
  | { kind: 'run'; tool: string; args: string[] }
  | {
      kind: 'batch';
      tool: string;
      paths: string[];
      args: string[];
      inputArg: string;
      concurrency: number;
      failFast: boolean;
      extensions: string[];
      recursive: boolean;
    }
  | { kind: 'tools-list'; category: string | undefined }
  | { kind: 'tools-show'; id: string }
  | { kind: 'config-show' }
  | { kind: 'config-init'; force: boolean }
  | { kind: 'config-path' }
  | { kind: 'audit'; limit: number }
  | { kind: 'doctor' }
  | { kind: 'tui' }
  | { kind: 'help' }
  | { kind: 'version' };

export interface Parsed {
  globals: Globals;
  command: Command;
}

/** Commands a bare word may name; anything else is a tool id. */
const COMMANDS = new Set(['run', 'batch', 'tools', 'config', 'audit', 'doctor', 'tui', 'help', 'version']);

/** Flags that take a value, so the next token is not a positional. */
const VALUE_FLAGS = new Set([
  '--home',
  '--format',
  '--output',
  '--arg',
  '--input-arg',
  '--concurrency',
  '-c',
  '--ext',
  '--limit',
  '-l',
  '--category',
]);

/** Flags that stand alone. */
const BOOLEAN_FLAGS = new Set([
  '--json',
  '--quiet',
  '-q',
  '--dry-run',
  '--strict',
  '--fail-fast',
  '--no-recursive',
  '--force',
  '-v',
  '-vv',
  '--verbose',
]);

export function parseArgs(argv: readonly string[]): Parsed {
  const globals: Globals = {
    home: undefined,
    format: undefined,
    output: undefined,
    quiet: false,
    dryRun: false,
    strict: false,
    verbose: 0,
  };

  const positional: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index]!;
    const inline = inlineValue(token);

    if (inline) {
      // Only the global flags are applied here; a command flag's value is read
      // where the command is parsed.
      if (inline.flag === '--home' || inline.flag === '--format' || inline.flag === '--output') {
        applyGlobal(globals, inline.flag, inline.value);
      } else if (!VALUE_FLAGS.has(inline.flag) && !BOOLEAN_FLAGS.has(inline.flag)) {
        throw invalidArgs(`unknown flag '${inline.flag}' (try --help)`);
      }
      index += 1;
      continue;
    }

    if (VALUE_FLAGS.has(token)) {
      const next = argv[index + 1];
      if (next === undefined) throw invalidArgs(`${token} needs a value`);
      if (token === '--home' || token === '--format' || token === '--output') applyGlobal(globals, token, next);
      index += 2;
      continue;
    }

    switch (token) {
      case '--json':
        globals.format = 'json';
        index += 1;
        continue;
      case '--quiet':
      case '-q':
        globals.quiet = true;
        index += 1;
        continue;
      case '--dry-run':
        globals.dryRun = true;
        index += 1;
        continue;
      case '--strict':
        globals.strict = true;
        index += 1;
        continue;
      case '-v':
      case '--verbose':
        globals.verbose += 1;
        index += 1;
        continue;
      case '-vv':
        globals.verbose += 2;
        index += 1;
        continue;
      case '-h':
      case '--help':
        return { globals, command: { kind: 'help' } };
      case '-V':
      case '--version':
        return { globals, command: { kind: 'version' } };
      default:
        if (BOOLEAN_FLAGS.has(token)) {
          index += 1;
          continue;
        }
        if (token.startsWith('-') && token !== '-') {
          throw invalidArgs(`unknown flag '${token}' (try --help)`);
        }
        positional.push(token);
        index += 1;
    }
  }

  return { globals, command: parseCommand(positional, argv) };
}

function inlineValue(token: string): { flag: string; value: string } | undefined {
  if (!token.startsWith('--')) return undefined;
  const at = token.indexOf('=');
  if (at < 0) return undefined;
  return { flag: token.slice(0, at), value: token.slice(at + 1) };
}

function applyGlobal(globals: Globals, flag: string, value: string): void {
  switch (flag) {
    case '--home':
      globals.home = value;
      return;
    case '--format':
      globals.format = parseFormat(value);
      return;
    case '--output':
      globals.output = value;
      return;
    default:
      throw invalidArgs(`unknown flag '${flag}' (try --help)`);
  }
}

function parseFormat(value: string): OutputFormat {
  switch (value.trim().toLowerCase()) {
    case 'text':
    case 'plain':
      return 'text';
    case 'json':
      return 'json';
    case 'markdown':
    case 'md':
      return 'markdown';
    case 'csv':
      return 'csv';
    case 'html':
    case 'htm':
      return 'html';
    default:
      throw invalidArgs(`unknown output format '${value}'`);
  }
}

function parseCommand(positional: string[], argv: readonly string[]): Command {
  const [head, ...rest] = positional;
  if (head === undefined) return { kind: 'help' };
  if (head === 'help') return { kind: 'help' };
  if (head === 'version') return { kind: 'version' };

  if (!COMMANDS.has(head)) {
    // `gimlet system-info` is shorthand for `gimlet run system-info`.
    return { kind: 'run', tool: head, args: rest };
  }

  switch (head) {
    case 'run': {
      const [tool, ...args] = rest;
      if (tool === undefined) throw invalidArgs('run needs a tool id');
      return { kind: 'run', tool, args };
    }
    case 'batch':
      return parseBatch(rest, argv);
    case 'tools': {
      const [sub, ...tail] = rest;
      switch (sub) {
        case 'list': {
          const category = flagValue(argv, '--category');
          return { kind: 'tools-list', category };
        }
        case 'show': {
          const id = tail[0];
          if (id === undefined) throw invalidArgs('tools show needs a tool id');
          return { kind: 'tools-show', id };
        }
        default:
          throw invalidArgs(`unknown tools subcommand '${sub ?? ''}' (list, show)`);
      }
    }
    case 'config': {
      const [sub] = rest;
      switch (sub) {
        case 'show':
          return { kind: 'config-show' };
        case 'init':
          return { kind: 'config-init', force: argv.includes('--force') };
        case 'path':
          return { kind: 'config-path' };
        default:
          throw invalidArgs(`unknown config subcommand '${sub ?? ''}' (show, init, path)`);
      }
    }
    case 'audit':
      return { kind: 'audit', limit: Number(flagValue(argv, '--limit') ?? flagValue(argv, '-l') ?? 20) };
    case 'doctor':
      return { kind: 'doctor' };
    case 'tui':
      return { kind: 'tui' };
    default:
      throw invalidArgs(`unknown command '${head}' (try --help)`);
  }
}

function parseBatch(rest: string[], argv: readonly string[]): Command {
  const [tool, ...paths] = rest;
  if (tool === undefined) throw invalidArgs('batch needs a tool id');
  if (paths.length === 0) throw invalidArgs('batch needs at least one path');

  const concurrency = Number(flagValue(argv, '--concurrency') ?? flagValue(argv, '-c') ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw invalidArgs('--concurrency must be between 1 and 32');
  }

  return {
    kind: 'batch',
    tool,
    paths,
    args: flagValues(argv, '--arg'),
    inputArg: flagValue(argv, '--input-arg') ?? 'input',
    concurrency,
    failFast: argv.includes('--fail-fast'),
    extensions: flagValues(argv, '--ext'),
    recursive: !argv.includes('--no-recursive'),
  };
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === flag) return argv[index + 1];
    if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
  }
  return undefined;
}

function flagValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === flag && argv[index + 1] !== undefined) values.push(argv[index + 1]!);
    else if (token.startsWith(`${flag}=`)) values.push(token.slice(flag.length + 1));
  }
  return values;
}
