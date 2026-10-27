import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nodeHost } from '@gimlet-eye/core';
import { parseArgs } from '../src/cli.js';
import { collectFiles, executeBatch } from '../src/batch.js';

describe('command parsing', () => {
  it('treats a bare word as a tool id', () => {
    const parsed = parseArgs(['system-info']);
    expect(parsed.command).toEqual({ kind: 'run', tool: 'system-info', args: [] });
  });

  it('keeps key=value pairs with the tool', () => {
    const parsed = parseArgs(['crypto.sha256', 'text=hello', 'upper=true']);
    expect(parsed.command).toEqual({ kind: 'run', tool: 'crypto.sha256', args: ['text=hello', 'upper=true'] });
  });

  it('reads global flags before or after the command', () => {
    expect(parseArgs(['--json', 'doctor']).globals.format).toBe('json');
    expect(parseArgs(['doctor', '--format', 'markdown']).globals.format).toBe('markdown');
    expect(parseArgs(['--home=/tmp/x', 'doctor']).globals.home).toBe('/tmp/x');
    expect(parseArgs(['-vv', 'doctor']).globals.verbose).toBe(2);
  });

  it('parses batch options without treating their values as paths', () => {
    const parsed = parseArgs([
      'batch',
      'crypto.sha256',
      '/tmp/a',
      '/tmp/b',
      '--arg',
      'text=hello',
      '--input-arg',
      'input',
      '-c',
      '8',
      '--ext',
      '.jpg',
      '--fail-fast',
      '--no-recursive',
    ]);
    expect(parsed.command).toMatchObject({
      kind: 'batch',
      tool: 'crypto.sha256',
      paths: ['/tmp/a', '/tmp/b'],
      args: ['text=hello'],
      inputArg: 'input',
      concurrency: 8,
      failFast: true,
      extensions: ['.jpg'],
      recursive: false,
    });
  });

  it('rejects what it cannot understand instead of guessing', () => {
    expect(() => parseArgs(['--nope', 'doctor'])).toThrow(/unknown flag/);
    expect(() => parseArgs(['--format', 'xml', 'doctor'])).toThrow(/unknown output format/);
    expect(() => parseArgs(['batch', 'crypto.sha256'])).toThrow(/at least one path/);
    expect(() => parseArgs(['batch', 'x', '/tmp', '-c', '99'])).toThrow(/between 1 and 32/);
  });

  it('knows its subcommands', () => {
    expect(parseArgs(['tools', 'list', '--category', 'crypto']).command).toEqual({
      kind: 'tools-list',
      category: 'crypto',
    });
    expect(parseArgs(['tools', 'show', 'crypto.sha256']).command).toEqual({
      kind: 'tools-show',
      id: 'crypto.sha256',
    });
    expect(parseArgs(['config', 'init', '--force']).command).toEqual({ kind: 'config-init', force: true });
    expect(parseArgs(['audit', '--limit', '5']).command).toEqual({ kind: 'audit', limit: 5 });
  });
});

describe('batch execution', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
    vi.restoreAllMocks();
  });

  it('finds files, honours --ext, and names each one in the aggregate', async () => {
    dir = await mkdtemp(join(tmpdir(), 'gimlet-batch-'));
    await writeFile(join(dir, 'a.jpg'), 'x');
    await writeFile(join(dir, 'b.txt'), 'x');
    const host = nodeHost();

    const files = await collectFiles(host, [dir], ['jpg'], true);
    expect(files).toEqual([join(dir, 'a.jpg')]);

    const printed: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    });
    const seen: string[] = [];
    const summary = await executeBatch(
      host,
      {
        async run(_tool, args) {
          seen.push(String(args['input']));
          return { tool: 'demo', status: 'ok', summary: 'fine', duration_ms: 1 };
        },
      },
      {
        tool: 'demo',
        paths: [dir],
        args: {},
        inputArg: 'input',
        concurrency: 2,
        failFast: false,
        extensions: ['jpg'],
        recursive: true,
      },
      'text',
    );

    expect(seen).toEqual([join(dir, 'a.jpg')]);
    expect(summary.status).toBe('ok');
    expect(printed.join('')).toContain('1 of 1 file(s): 1 ok, 0 warning(s), 0 error(s)');
  });

  it('turns a failing file into a high finding', async () => {
    dir = await mkdtemp(join(tmpdir(), 'gimlet-batch-'));
    await writeFile(join(dir, 'a.bin'), 'x');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const summary = await executeBatch(
      nodeHost(),
      {
        async run() {
          throw new Error('nope');
        },
      },
      {
        tool: 'demo',
        paths: [dir],
        args: {},
        inputArg: 'input',
        concurrency: 1,
        failFast: false,
        extensions: [],
        recursive: true,
      },
      'json',
    );
    expect(summary.status).toBe('error');
  });

  it('refuses --arg and --input-arg naming the same key', async () => {
    dir = await mkdtemp(join(tmpdir(), 'gimlet-batch-'));
    await writeFile(join(dir, 'a.bin'), 'x');
    await expect(
      executeBatch(
        nodeHost(),
        { run: async () => ({ tool: 'd', status: 'ok', summary: '', duration_ms: 0 }) },
        {
          tool: 'd',
          paths: [dir],
          args: { input: 'clobbered' },
          inputArg: 'input',
          concurrency: 1,
          failFast: false,
          extensions: [],
          recursive: true,
        },
        'text',
      ),
    ).rejects.toThrow(/conflicts with --input-arg/);
  });
});
