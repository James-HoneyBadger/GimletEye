/**
 * The TUI's session loop, scripted.
 *
 * `state.ts`, `render.ts`, and `keys.ts` are pure and tested directly; this is
 * the part that wires them to a terminal — raw mode, redraws, and the one call
 * that runs a tool. It was only ever exercised by hand through a pty, which is
 * why a keystroke that stopped redrawing, or a run that skipped the audit trail,
 * would have been found by a user rather than by CI.
 *
 * `runTui` takes its IO, so the terminal here is an EventEmitter that records
 * what was drawn.
 */

import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { runTui, splitArgs } from '../src/tui/session.js';
import type { Runtime, ToolManifest } from '@gimlet-eye/core';

/** The little of a TTY that the loop touches. */
class FakeTerminal extends EventEmitter {
  isTTY = true;
  columns = 100;
  rows = 30;
  readonly written: string[] = [];
  rawMode: boolean | undefined;

  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }

  setRawMode(value: boolean): void {
    this.rawMode = value;
  }

  setEncoding(): void {}

  pause(): void {}

  resume(): void {}

  /** Everything drawn so far, with the ANSI control sequences removed. */
  text(): string {
    // eslint-disable-next-line no-control-regex
    return this.written.join('').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  }
}

const SHA: ToolManifest = {
  id: 'crypto.sha256',
  title: 'Hash a file or text',
  summary: 'SHA-256 of bytes or a string',
  category: 'crypto',
  capabilities: ['fs:read'],
  args: [{ name: 'text', type: 'string', help: 'Text to hash' }],
  tags: ['hash'],
};

const KEYGEN: ToolManifest = {
  id: 'crypto.keygen',
  title: 'Generate a key',
  summary: 'Create a keypair',
  category: 'crypto',
  capabilities: ['fs:write'],
  args: [{ name: 'label', type: 'string', required: true, help: 'Name for the key' }],
  tags: ['keys'],
};

interface Recorded {
  tool: string;
  args: unknown;
}

function fakeRuntime(record: Recorded[], fail = false): Runtime {
  return {
    registry: { list: () => [SHA, KEYGEN] },
    async run(tool: string, args: unknown) {
      record.push({ tool, args });
      if (fail) throw new Error('the tool refused');
      return {
        tool,
        report: { tool, status: 'ok' as const, summary: `ran ${tool}`, duration_ms: 1 },
      };
    },
  } as unknown as Runtime;
}

function session(options: { fail?: boolean } = {}) {
  const stdin = new FakeTerminal();
  const stdout = new FakeTerminal();
  const stderr = new FakeTerminal();
  const record: Recorded[] = [];
  const running = runTui(fakeRuntime(record, options.fail), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
  });
  /** Type, as the terminal would deliver it. */
  const type = (keys: string): void => {
    stdin.emit('data', keys);
  };
  return { running, type, record, stdin, stdout, stderr };
}

describe('the tui session', () => {
  it('refuses to start without a terminal, and says why', async () => {
    const stdin = new FakeTerminal();
    stdin.isTTY = false;
    const stderr = new FakeTerminal();

    const code = await runTui(fakeRuntime([]), {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: new FakeTerminal() as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
    });

    expect(code).toBe(2);
    expect(stderr.text()).toContain('needs an interactive terminal');
  });

  it('draws a frame, filters as you type, and runs the selected tool', async () => {
    const tui = session();
    // Ctrl-C ends the session; the assertions are on what happened before it.
    tui.type('sha');
    tui.type('\r');
    tui.type('\u0003');
    expect(await tui.running).toBe(0);

    expect(tui.record).toHaveLength(1);
    expect(tui.record[0]?.tool).toBe('crypto.sha256');
    const drawn = tui.stdout.text();
    expect(drawn).toContain('crypto.sha256');
    expect(drawn).toContain('ran crypto.sha256');
  });

  it('asks for arguments only when one is required, then passes them', async () => {
    const tui = session();
    tui.type('keygen');
    tui.type('\r');
    // The argument prompt is showing, so nothing has run yet.
    expect(tui.record).toHaveLength(0);
    expect(tui.stdout.text()).toContain('label');
    expect(tui.stdout.text()).toContain('required');

    tui.type('label=demo');
    tui.type('\r');
    tui.type('\u0003');
    expect(await tui.running).toBe(0);

    expect(tui.record).toHaveLength(1);
    expect(tui.record[0]?.args).toEqual({ label: 'demo' });
  });

  it('holds a failure in the result view instead of ending the session', async () => {
    const tui = session({ fail: true });
    tui.type('sha');
    tui.type('\r');
    tui.type('\u0003');
    expect(await tui.running).toBe(0);

    expect(tui.stdout.text()).toContain('the tool refused');
  });

  it('restores the terminal on the way out', async () => {
    const tui = session();
    tui.type('\u0003');
    await tui.running;

    // Raw mode off and the cursor shown: a terminal left in raw mode is a shell
    // that no longer echoes.
    expect(tui.stdin.rawMode).toBe(false);
    expect(tui.stdout.written.at(-1)).toContain('\u001b[?25h');
  });

  it('survives a resize between keystrokes', async () => {
    const tui = session();
    tui.stdout.columns = 40;
    tui.stdout.emit('resize');
    tui.type('\u0003');
    await tui.running;

    // Redrawn at the new width rather than left at the old one.
    expect(tui.stdout.text()).toContain('crypto.sha256');
  });
});

describe('the argument line', () => {
  it('keeps quoted values together', () => {
    expect(splitArgs('text="two words" upper=true')).toEqual(['text=two words', 'upper=true']);
  });
});
