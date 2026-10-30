/**
 * Batch execution: one tool, many files.
 *
 * Privacy work is per-directory in practice, not per-file. This keeps the
 * per-file report — so a failure names its file — and folds the results into one
 * aggregate report that the existing renderers already know how to print.
 */

import {
  GimletError,
  basename,
  invalidArgs,
  join,
  notFound,
  render,
  sealed,
  type Args,
  type Host,
  type OutputFormat,
  type Report,
} from '@gimlet-eye/core';

import { write, writeLine } from './output.js';

const MAX_WALK_DEPTH = 16;

export interface BatchOptions {
  tool: string;
  paths: string[];
  args: Args;
  inputArg: string;
  concurrency: number;
  failFast: boolean;
  extensions: string[];
  recursive: boolean;
}

export interface BatchRunner {
  run(tool: string, args: Args): Promise<Report>;
}

export interface BatchSummary {
  status: Report['status'];
  duration_ms: number;
}

interface Outcome {
  index: number;
  path: string;
  duration_ms: number;
  report?: Report;
  error?: string;
}

/** Run `tool` once per file and print an aggregate report. */
export async function executeBatch(
  host: Host,
  runner: BatchRunner,
  options: BatchOptions,
  format: OutputFormat,
): Promise<BatchSummary> {
  if (Object.hasOwn(options.args, options.inputArg)) {
    throw invalidArgs(
      `--arg ${options.inputArg}=… conflicts with --input-arg ${options.inputArg}: the file path would replace it`,
    );
  }

  const files = await collectFiles(host, options.paths, options.extensions, options.recursive);
  if (files.length === 0) {
    throw notFound(`no files to process in ${describePaths(options.paths)}`);
  }

  const started = Date.now();
  const outcomes = await runAll(runner, options, files);
  // Wall time, not the sum of per-file times: with `--concurrency 4` the two
  // differ by a factor of four, and this is what the audit trail records.
  const report = aggregate(options, files, outcomes, Date.now() - started);

  if (format === 'text') {
    for (const outcome of outcomes) writeLine(outcomeLine(outcome));
    writeLine();
    const display: Report = { ...report, data: withoutFiles(report.data) };
    write(render(display, format));
  } else {
    write(render(report, format));
  }

  const skipped = files.length - outcomes.length;
  if (skipped > 0) {
    process.stderr.write(`stopped after the first failure (${skipped} file(s) not processed)\n`);
  }

  return { status: report.status, duration_ms: report.duration_ms };
}

/** Expand paths into a deterministic file list. */
export async function collectFiles(
  host: Host,
  paths: readonly string[],
  extensions: readonly string[],
  recursive: boolean,
): Promise<string[]> {
  const wanted = extensions
    .map((ext) => ext.replace(/^\./, '').toLowerCase())
    .filter((ext) => ext !== '');

  const files: string[] = [];
  const visited = new Set<string>();
  for (const path of paths) {
    if (!(await host.exists(path))) throw notFound(`${path} does not exist`);
    const info = await host.stat(path);
    if (info.isFile) {
      if (accepts(path, wanted)) files.push(path);
      continue;
    }
    if (info.isDirectory) {
      await walk(host, path, wanted, recursive ? MAX_WALK_DEPTH : 1, visited, files);
      continue;
    }
    throw notFound(`${path} is neither a file nor a directory`);
  }

  return [...new Set(files)].sort();
}

async function walk(
  host: Host,
  dir: string,
  wanted: readonly string[],
  depth: number,
  visited: Set<string>,
  out: string[],
): Promise<void> {
  if (depth === 0) return;
  try {
    const canonical = await host.resolve(dir);
    // Symlink cycles are the reason for the visited set: a link back up the
    // tree would otherwise walk forever.
    if (visited.has(canonical)) return;
    visited.add(canonical);
  } catch {
    // A directory that cannot be resolved is still readable by path.
  }

  let entries: string[];
  try {
    entries = await host.readDir(dir);
  } catch (error) {
    throw new GimletError('io', `cannot read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    const info = await host.stat(path);
    if (info.isFile) {
      if (accepts(path, wanted)) out.push(path);
      continue;
    }
    if (info.isDirectory) await walk(host, path, wanted, depth - 1, visited, out);
  }
}

function accepts(path: string, wanted: readonly string[]): boolean {
  if (wanted.length === 0) return true;
  // `basename` normalises both separators, so a Windows path selects the same
  // files a POSIX one does.
  const name = basename(path);
  const at = name.lastIndexOf('.');
  if (at <= 0) return false;
  return wanted.includes(name.slice(at + 1).toLowerCase());
}

async function runAll(runner: BatchRunner, options: BatchOptions, files: readonly string[]): Promise<Outcome[]> {
  const workers = Math.min(Math.max(options.concurrency, 1), 32, Math.max(files.length, 1));
  const queue = files.map((path, index) => ({ index, path }));
  const outcomes: Outcome[] = [];
  let stop = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.failFast && stop) return;
      const next = queue.shift();
      if (next === undefined) return;

      const started = Date.now();
      const args: Args = { ...options.args, [options.inputArg]: next.path };
      try {
        const report = await runner.run(options.tool, args);
        const failed = report.status === 'error';
        if (failed && options.failFast) stop = true;
        outcomes.push({ index: next.index, path: next.path, duration_ms: Date.now() - started, report });
      } catch (error) {
        if (options.failFast) stop = true;
        outcomes.push({
          index: next.index,
          path: next.path,
          duration_ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, worker));
  return outcomes.sort((a, b) => a.index - b.index);
}

function aggregate(
  options: BatchOptions,
  files: readonly string[],
  outcomes: readonly Outcome[],
  durationMs: number,
): Report {
  let ok = 0;
  let warnings = 0;
  let errors = 0;
  const findings: NonNullable<Report['findings']> = [];
  const entries: Record<string, unknown>[] = [];

  for (const outcome of outcomes) {
    const input = outcome.path;
    if (outcome.report) {
      const report = outcome.report;
      switch (report.status) {
        case 'ok':
          ok += 1;
          break;
        case 'warning':
          warnings += 1;
          // Findings drive the sealed status, so a warning file must leave one.
          findings.push({ severity: 'medium', code: 'file-warning', message: `${input}: ${report.summary}` });
          break;
        case 'error':
          errors += 1;
          findings.push({ severity: 'high', code: 'file-failed', message: `${input}: ${report.summary}` });
          break;
      }
      entries.push({
        input,
        status: report.status,
        summary: report.summary,
        findings: report.findings?.length ?? 0,
        duration_ms: outcome.duration_ms,
      });
    } else {
      errors += 1;
      const message = outcome.error ?? 'failed';
      findings.push({ severity: 'high', code: 'file-failed', message: `${input}: ${message}` });
      entries.push({ input, status: 'error', error: message, duration_ms: outcome.duration_ms });
    }
  }

  const processed = outcomes.length;
  const skipped = files.length - processed;
  let summary = `${processed} of ${files.length} file(s): ${ok} ok, ${warnings} warning(s), ${errors} error(s)`;
  if (options.failFast && skipped > 0) summary += `; stopped after the first failure, ${skipped} skipped`;

  return sealed({
    tool: options.tool,
    status: 'ok',
    summary,
    findings,
    data: {
      tool: options.tool,
      input_arg: options.inputArg,
      total: files.length,
      processed,
      skipped,
      ok,
      warning: warnings,
      error: errors,
      files: entries,
    },
    duration_ms: durationMs,
  });
}

function outcomeLine(outcome: Outcome): string {
  const symbol = outcome.report ? statusSymbol(outcome.report.status) : '✖';
  const detail = outcome.report ? outcome.report.summary : (outcome.error ?? 'failed');
  return `${symbol} ${outcome.path}  (${outcome.duration_ms} ms)  ${detail}`;
}

function statusSymbol(status: Report['status']): string {
  return status === 'ok' ? '✔' : status === 'warning' ? '!' : '✖';
}

function withoutFiles(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const { files: _files, ...rest } = data as Record<string, unknown>;
  return rest;
}

function describePaths(paths: readonly string[]): string {
  return paths.length === 1 ? paths[0]! : `${paths.length} paths`;
}
