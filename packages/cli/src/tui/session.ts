/**
 * The terminal surface, wired to a real terminal.
 *
 * Everything decidable lives in `state.ts` and `render.ts`; this file owns the
 * TTY: raw mode, redraws, and the one call that executes a tool. It goes through
 * `Runtime.run` like every other surface, so a run started here lands in the
 * audit trail.
 */

import { fromPairs, render, type Runtime, type ToolManifest } from '@gimlet-eye/core';

import { decodeKeys } from './keys.js';
import { renderFrame, type Size } from './render.js';
import {
  back,
  beginArguments,
  eraseChar,
  failed,
  initialState,
  move,
  needsArguments,
  scrollResult,
  selected,
  setFilter,
  succeeded,
  typeChar,
  type TuiState,
  visible,
} from './state.js';

export interface TuiIo {
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
}

export function defaultIo(): TuiIo {
  return { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
}

export async function runTui(runtime: Runtime, io: TuiIo = defaultIo()): Promise<number> {
  if (io.stdin.isTTY !== true || io.stdout.isTTY !== true) {
    io.stderr.write('gimlet: tui needs an interactive terminal (stdin and stdout must be a TTY)\n');
    return 2;
  }

  const manifests = runtime.registry.list();
  let state: TuiState = initialState;
  let carry = '';
  let closed = false;

  const size = (): Size => ({
    // A pty can report 0 before it is resized, so an explicit zero falls back
    // to a usable frame instead of collapsing the list to its minimum width.
    width: io.stdout.columns || 100,
    height: io.stdout.rows || 30,
  });

  const draw = (): void => {
    const frame = renderFrame(state, manifests, size());
    io.stdout.write(`\u001b[H\u001b[2J${frame.join('\n')}`);
  };

  return await new Promise<number>((resolve) => {
    const finish = (code: number): void => {
      if (closed) return;
      closed = true;
      io.stdin.setRawMode(false);
      io.stdin.pause();
      io.stdin.removeListener('data', onData);
      io.stdout.off('resize', draw);
      io.stdout.write('\u001b[?25h\n');
      resolve(code);
    };

    const run = async (manifest: ToolManifest, args: readonly string[]): Promise<void> => {
      io.stdout.write('\u001b[H\u001b[2J  running…');
      try {
        const { report } = await runtime.run(manifest.id, fromPairs(args));
        state = succeeded(state, report);
      } catch (error) {
        state = failed(state, error instanceof Error ? error.message : String(error));
      }
      draw();
    };

    const onData = (chunk: string): void => {
      const decoded = decodeKeys(chunk, carry);
      carry = decoded.remainder;
      for (const intent of decoded.intents) {
        if (intent.kind === 'interrupt') return finish(0);

        if (state.mode === 'browse') {
          const rows = visible(manifests, state.filter);
          switch (intent.kind) {
            case 'up':
              state = move(state, -1, rows.length);
              break;
            case 'down':
              state = move(state, 1, rows.length);
              break;
            case 'backspace':
              state = setFilter(state, state.filter.slice(0, -1), rows.length);
              break;
            case 'escape':
              state = setFilter(state, '', rows.length);
              break;
            case 'char':
              state = setFilter(state, state.filter + intent.value, rows.length);
              break;
            case 'enter': {
              const manifest = selected(state, manifests);
              if (manifest === undefined) break;
              if (needsArguments(manifest)) {
                state = beginArguments(state, manifest);
              } else {
                void run(manifest, []);
                return;
              }
              break;
            }
            default:
              break;
          }
        } else if (state.mode === 'args') {
          switch (intent.kind) {
            case 'char':
              state = typeChar(state, intent.value);
              break;
            case 'backspace':
              state = eraseChar(state);
              break;
            case 'escape':
              state = back(state);
              break;
            case 'enter': {
              const manifest = manifests.find((candidate) => candidate.id === state.toolId);
              if (manifest === undefined) {
                state = failed(state, `unknown tool '${state.toolId ?? ''}'`);
                break;
              }
              void run(manifest, splitArgs(state.input));
              return;
            }
            default:
              break;
          }
        } else {
          const total = resultLineCount(state);
          const page = Math.max(1, size().height - 3);
          switch (intent.kind) {
            case 'up':
              state = scrollResult(state, -1, total, page);
              break;
            case 'down':
              state = scrollResult(state, 1, total, page);
              break;
            case 'pageUp':
              state = scrollResult(state, -page, total, page);
              break;
            case 'pageDown':
              state = scrollResult(state, page, total, page);
              break;
            case 'enter':
            case 'escape':
              state = back(state);
              break;
            default:
              break;
          }
        }
      }
      draw();
    };

    io.stdout.write('\u001b[?25l');
    io.stdin.setRawMode(true);
    io.stdin.resume();
    io.stdin.setEncoding('utf8');
    io.stdin.on('data', onData);
    io.stdout.on('resize', draw);
    draw();
  });
}

/** `key=value key2=value2`, with quotes allowed around a value with spaces. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  const pattern = /([\w.-]+)=("([^"]*)"|'([^']*)'|\S*)/g;
  for (const match of line.matchAll(pattern)) {
    out.push(`${match[1]}=${match[3] ?? match[4] ?? match[2] ?? ''}`);
  }
  return out;
}

function resultLineCount(state: TuiState): number {
  if (state.error !== undefined) return 1;
  return state.report === undefined ? 0 : render(state.report, 'text').trimEnd().split('\n').length;
}
