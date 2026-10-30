/**
 * External commands are bounded.
 *
 * `df` and `gpg` are the only programs the toolkit runs, and both are trusted
 * to be well-behaved — but a hostile file name is not the only input a run has:
 * a wedged gpg-agent holds the child open, and a chatty failure can emit an
 * unbounded amount of text. Neither may hold a run, or its report, hostage.
 */

import { describe, expect, it } from 'vitest';

import { EXEC_TIMED_OUT, execOnce } from '../src/host-node.js';

describe('running an external program', () => {
  it('reports a missing program instead of throwing', async () => {
    const result = await execOnce('gimlet-program-that-does-not-exist', []);

    expect(result.code).toBe(127);
    expect(result.stderr).toContain('not found');
  });

  it('kills a command that outlives its budget', async () => {
    const result = await execOnce(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], 50);

    expect(result.code).toBe(EXEC_TIMED_OUT);
    expect(result.stderr).toMatch(/timed out/);
  });

  it('caps what it keeps, and says so', async () => {
    const result = await execOnce(process.execPath, ['-e', 'process.stdout.write("x".repeat(2_000_000))'], 5_000);

    expect(result.stdout.length).toBe(1024 * 1024);
    expect(result.stderr).toMatch(/truncated/);
  });

  it('passes a normal result through unchanged', async () => {
    const result = await execOnce(process.execPath, ['-e', 'process.stdout.write("ok")']);

    expect(result).toEqual({ code: 0, stdout: 'ok', stderr: '' });
  });
});
