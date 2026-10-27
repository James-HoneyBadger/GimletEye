import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/cli.js';
import { decodeKeys } from '../src/tui/keys.js';
import { renderFrame, truncate } from '../src/tui/render.js';
import {
  beginArguments,
  back,
  failed,
  initialState,
  matches,
  move,
  needsArguments,
  scrollResult,
  selected,
  setFilter,
  succeeded,
  typeChar,
  visible,
} from '../src/tui/state.js';
import { splitArgs } from '../src/tui/session.js';
import type { Report, ToolManifest } from '@gimlet-eye/core';

const manifest = (id: string, over: Partial<ToolManifest> = {}): ToolManifest => ({
  id,
  title: id,
  summary: `about ${id}`,
  category: 'sysadmin',
  ...over,
});

const manifests: ToolManifest[] = [
  manifest('crypto.keygen', { summary: 'Generate a key', tags: ['key', 'secrets'] }),
  manifest('crypto.sha256', { summary: 'Hash text', tags: ['hash'] }),
  manifest('sysadmin.disk-usage', { summary: 'What fills the disk' }),
];

const report: Report = { tool: 'crypto.sha256', status: 'ok', summary: 'done', duration_ms: 2 };

describe('the tui is reachable from the command line', () => {
  it('parses as its own command, not a tool id', () => {
    expect(parseArgs(['tui']).command).toEqual({ kind: 'tui' });
  });

  it('accepts html everywhere a format is accepted', () => {
    expect(parseArgs(['doctor', '--format', 'html']).globals.format).toBe('html');
  });
});

describe('filtering', () => {
  it('matches every word across id, summary, and tags', () => {
    expect(matches(manifests[0] as ToolManifest, 'crypto key')).toBe(true);
    expect(matches(manifests[0] as ToolManifest, 'crypto disk')).toBe(false);
    expect(matches(manifests[2] as ToolManifest, 'disk')).toBe(true);
  });

  it('lists everything, sorted, when the filter is empty', () => {
    expect(visible(manifests, '   ').map((entry) => entry.id)).toEqual([
      'crypto.keygen',
      'crypto.sha256',
      'sysadmin.disk-usage',
    ]);
  });

  it('never leaves the cursor past the end of a narrowed list', () => {
    const state = move(initialState, 2, 3);
    expect(state.cursor).toBe(2);
    expect(setFilter(state, 'crypto', 2).cursor).toBe(1);
    expect(setFilter(state, 'nothing-here', 0).cursor).toBe(0);
  });

  it('wraps at both ends', () => {
    expect(move(initialState, -1, 3).cursor).toBe(2);
    expect(move({ ...initialState, cursor: 2 }, 1, 3).cursor).toBe(0);
  });

  it('resolves the selected row', () => {
    expect(selected({ ...initialState, cursor: 1 }, manifests)?.id).toBe('crypto.sha256');
  });
});

describe('running', () => {
  it('asks for arguments only when one is required', () => {
    expect(needsArguments(manifest('a', { args: [{ name: 'path', type: 'path', required: true }] }))).toBe(true);
    expect(needsArguments(manifest('a', { args: [{ name: 'upper', type: 'boolean' }] }))).toBe(false);
    expect(needsArguments(manifest('a'))).toBe(false);
  });

  it('splits key=value lines, quotes included', () => {
    expect(splitArgs('text=hello upper=true')).toEqual(['text=hello', 'upper=true']);
    expect(splitArgs('text="two words" path=/tmp/x')).toEqual(['text=two words', 'path=/tmp/x']);
    expect(splitArgs('empty=')).toEqual(['empty=']);
    expect(splitArgs('nonsense')).toEqual([]);
  });

  it('keeps the typed argument line and returns to browsing', () => {
    let state = beginArguments(initialState, manifest('crypto.sha256'));
    state = typeChar(state, 't');
    state = typeChar(state, '=');
    expect(state).toMatchObject({ mode: 'args', toolId: 'crypto.sha256', input: 't=' });
    expect(back(state).mode).toBe('browse');
    expect(back(state).input).toBe('');
  });

  it('holds a report or a failure for the result view', () => {
    expect(succeeded(initialState, report).report?.summary).toBe('done');
    expect(failed(initialState, 'no engine').error).toBe('no engine');
  });

  it('scrolls a result without running past either end', () => {
    const state = { ...initialState, mode: 'result' as const };
    expect(scrollResult(state, 5, 100, 10).scroll).toBe(5);
    expect(scrollResult({ ...state, scroll: 95 }, 10, 100, 10).scroll).toBe(90);
    expect(scrollResult(state, -1, 100, 10).scroll).toBe(0);
  });
});

describe('key decoding', () => {
  it('reads arrows, enter, backspace, and characters', () => {
    expect(decodeKeys('\u001b[A').intents).toEqual([{ kind: 'up' }]);
    expect(decodeKeys('\u001b[B').intents).toEqual([{ kind: 'down' }]);
    expect(decodeKeys('\r').intents).toEqual([{ kind: 'enter' }]);
    expect(decodeKeys('\u007f').intents).toEqual([{ kind: 'backspace' }]);
    expect(decodeKeys('\u0003').intents).toEqual([{ kind: 'interrupt' }]);
    expect(decodeKeys('ab').intents).toEqual([
      { kind: 'char', value: 'a' },
      { kind: 'char', value: 'b' },
    ]);
  });

  it('waits for an escape sequence split across two reads', () => {
    const first = decodeKeys('\u001b[');
    expect(first.intents).toEqual([]);
    expect(first.remainder).toBe('\u001b[');
    expect(decodeKeys('B', first.remainder).intents).toEqual([{ kind: 'down' }]);
  });

  it('treats a lone escape as Escape', () => {
    expect(decodeKeys('\u001b').intents).toEqual([{ kind: 'escape' }]);
  });
});

describe('the frame', () => {
  it('shows the count, the rows, and the cursor', () => {
    const frame = renderFrame({ ...initialState, filter: 'crypto' }, manifests, { width: 100, height: 20 });
    expect(frame[0]).toBe('Gimlet Eye · 2/3 tools  filter: crypto');
    expect(frame.some((line) => line.startsWith('> crypto.keygen'))).toBe(true);
    expect(frame.some((line) => line.startsWith('  crypto.sha256'))).toBe(true);
    expect(frame.at(-1)).toContain('enter run');
  });

  it('says so when nothing matches', () => {
    const frame = renderFrame({ ...initialState, filter: 'zzz' }, manifests, { width: 100, height: 20 });
    expect(frame.join('\n')).toContain('no tool matches that filter');
  });

  it('lists the arguments a tool needs', () => {
    const tool = manifest('crypto.encrypt', {
      args: [{ name: 'path', type: 'path', required: true, help: 'file to seal' }],
    });
    const state = beginArguments(initialState, tool, 'path=/tmp/a');
    const frame = renderFrame(state, [tool], { width: 100, height: 20 });
    expect(frame.join('\n')).toContain('path');
    expect(frame.join('\n')).toContain('file to seal');
    expect(frame.join('\n')).toContain('> path=/tmp/a');
  });

  it('renders a report, or the failure, in the result view', () => {
    const good = renderFrame(succeeded(initialState, report), manifests, { width: 100, height: 20 });
    expect(good.join('\n')).toContain('crypto.sha256');

    const bad = renderFrame(failed(initialState, 'no engine'), manifests, { width: 100, height: 20 });
    expect(bad.join('\n')).toContain('error: no engine');
  });

  it('truncates to the width it is given', () => {
    const frame = renderFrame({ ...initialState, filter: '' }, manifests, { width: 20, height: 10 });
    for (const line of frame) expect(line.length).toBeLessThanOrEqual(20);
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });
});
