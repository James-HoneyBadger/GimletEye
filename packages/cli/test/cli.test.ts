import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nodeHost } from '@gimlet-eye/core/host-node';
import { parseArgs } from '../src/cli.js';
import { collectFiles, executeBatch } from '../src/batch.js';
import { formatFromArgv, writeFailure } from '../src/output.js';
import { BATCH_FLAGS, COMMANDS, GLOBAL_FLAGS } from '../src/surface.js';

describe('failures in the shape the caller asked for', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a JSON object on stderr when the format is json', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeFailure('not_found', 'not found: /nope', 'json');

    const written = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(JSON.parse(written)).toEqual({ error: { code: 'not_found', message: 'not found: /nope' } });
  });

  it('keeps the one-line message for human formats', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeFailure('not_found', 'not found: /nope', 'text');

    expect(stderr.mock.calls.map((call) => String(call[0])).join('')).toBe('gimlet: not found: /nope\n');
  });

  it('finds the format even when parsing the command failed', () => {
    expect(formatFromArgv(['crypto.decrypt', 'input=x', '--format', 'json'])).toBe('json');
    expect(formatFromArgv(['--format=json', 'nonsense'])).toBe('json');
    expect(formatFromArgv(['sha256', 'text=x'])).toBeUndefined();
  });
});

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

describe('declared surface', () => {
  it('parses every command it documents', () => {
    for (const entry of COMMANDS) {
      const words = entry.command.split(' ');
      const argv = [...words];
      if (entry.command.startsWith('run')) argv.push('crypto.sha256');
      if (entry.command.startsWith('batch')) argv.push('crypto.sha256', '/tmp');
      if (entry.command.startsWith('tools show')) argv.push('crypto.sha256');
      expect(() => parseArgs(argv)).not.toThrow();
    }
  });

  it('parses every flag it documents', () => {
    const flags = [...GLOBAL_FLAGS, ...BATCH_FLAGS]
      .flatMap((entry) => entry.command.split(', '))
      .filter((flag) => flag.startsWith('-') && flag !== '-h' && flag !== '-V');

    for (const flag of flags) {
      // A value flag gets a value it would accept, so the test is about the
      // parser knowing the flag rather than about validation.
      const value = flag === '--format' ? 'json' : flag === '-c' || flag === '--concurrency' ? '4' : 'x';
      expect(() => parseArgs([flag, value, 'doctor'])).not.toThrow();
    }
  });
});
