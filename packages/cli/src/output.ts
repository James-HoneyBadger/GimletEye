/**
 * Stdout that survives a closed pipe.
 *
 * `gimlet tools list | head` must finish quietly. A write to a closed pipe
 * raises `EPIPE`, which unhandled turns an ordinary shell pipeline into a
 * backtrace, so every line goes through here.
 */

import { closeSync, openSync, writeSync } from 'node:fs';

import { GimletError } from '@gimlet-eye/core';

let patched = false;

/**
 * Where stdout goes, once the flags are known.
 *
 * `--output <file>` sends every line this module writes to a file, and `--quiet`
 * keeps them out of stdout entirely; both leave stderr alone, so a failure is
 * still visible. Doing it here rather than at each call site is what makes the
 * switches work for `batch`, `tools list`, and `doctor` without threading a
 * writer through them.
 */
let sink: number | undefined;
let silent = false;

export function configure(options: { output?: string | undefined; quiet: boolean }): void {
  silent = options.quiet;
  if (options.output === undefined) return;
  try {
    sink = openSync(options.output, 'w');
  } catch (error) {
    throw new GimletError('io', `cannot write ${options.output}: ${(error as Error).message}`);
  }
}

/** Close the file, if there is one. Safe to call more than once. */
export function finish(): void {
  if (sink === undefined) return;
  closeSync(sink);
  sink = undefined;
}

function tolerateClosedPipe(): void {
  if (patched) return;
  patched = true;
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    // The reader stopped listening; that is how `| head` ends.
    if (error.code === 'EPIPE') return;
    process.stderr.write(`gimlet: cannot write output: ${error.message}\n`);
  });
}

export function write(text: string): void {
  if (sink !== undefined) {
    writeSync(sink, text);
    return;
  }
  if (silent) return;
  tolerateClosedPipe();
  process.stdout.write(text);
}

export function writeLine(text = ''): void {
  write(`${text}\n`);
}

export function warn(text: string): void {
  process.stderr.write(`gimlet: ${text}\n`);
}

/**
 * A failure, in the shape the caller asked for.
 *
 * A script that runs `--format json` is parsing stdout; giving it a one-line
 * English sentence on stderr means every caller has to re-implement the wording.
 * With `json` it gets `{"error": {"code", "message"}}` and the same exit code.
 */
export function writeFailure(code: string, message: string, format: string | undefined): void {
  if (format === 'json') {
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
    return;
  }
  process.stderr.write(`gimlet: ${message}\n`);
}

/** The format named on the command line, for the case where parsing failed. */
export function formatFromArgv(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg.startsWith('--format=')) return arg.slice('--format='.length);
    if (arg === '--format') return argv[index + 1];
  }
  return undefined;
}
