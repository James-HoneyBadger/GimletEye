/**
 * The terminal surface's state, as values.
 *
 * Nothing here touches a terminal: the session loop feeds it keystrokes and
 * renders whatever comes back. That is what lets the behaviour be tested
 * without a TTY, which CI does not have.
 */

import type { Report, ToolManifest } from '@gimlet-eye/core';

export type Mode = 'browse' | 'args' | 'result';

export interface TuiState {
  readonly filter: string;
  readonly cursor: number;
  readonly mode: Mode;
  /** The `key=value` line while a tool is being given arguments. */
  readonly input: string;
  readonly toolId?: string;
  readonly report?: Report;
  readonly error?: string | undefined;
  /** Lines scrolled off the top of a result, so a long report stays readable. */
  readonly scroll: number;
}

export const initialState: TuiState = { filter: '', cursor: 0, mode: 'browse', input: '', scroll: 0 };

export function matches(manifest: ToolManifest, filter: string): boolean {
  const query = filter.trim().toLowerCase();
  if (query === '') return true;
  const haystack = [manifest.id, manifest.title, manifest.summary, ...(manifest.tags ?? [])]
    .join(' ')
    .toLowerCase();
  // Every word has to appear somewhere, so `crypto key` narrows instead of
  // matching nothing the way a single substring would.
  return query.split(/\s+/).every((word) => haystack.includes(word));
}

export function visible(manifests: readonly ToolManifest[], filter: string): ToolManifest[] {
  return manifests.filter((manifest) => matches(manifest, filter)).sort((a, b) => a.id.localeCompare(b.id));
}

export function selected(state: TuiState, manifests: readonly ToolManifest[]): ToolManifest | undefined {
  return visible(manifests, state.filter)[state.cursor];
}

/** Filtering re-clamps the cursor, so a narrower list never leaves it past the end. */
export function setFilter(state: TuiState, filter: string, count: number): TuiState {
  return { ...state, filter, cursor: clamp(state.cursor, count) };
}

export function move(state: TuiState, delta: number, count: number): TuiState {
  if (count === 0) return { ...state, cursor: 0 };
  const next = (state.cursor + delta + count) % count;
  return { ...state, cursor: next };
}

/** A tool with a required argument cannot be run from the list alone. */
export function needsArguments(manifest: ToolManifest): boolean {
  return (manifest.args ?? []).some((arg) => arg.required === true);
}

export function beginArguments(state: TuiState, manifest: ToolManifest, preset = ''): TuiState {
  return { ...state, mode: 'args', toolId: manifest.id, input: preset, error: undefined, scroll: 0 };
}

export function typeChar(state: TuiState, value: string): TuiState {
  return { ...state, input: state.input + value };
}

export function eraseChar(state: TuiState): TuiState {
  return { ...state, input: state.input.slice(0, -1) };
}

export function succeeded(state: TuiState, report: Report): TuiState {
  return { ...state, mode: 'result', report, error: undefined, scroll: 0 };
}

export function failed(state: TuiState, message: string): TuiState {
  return { ...state, mode: 'result', error: message, scroll: 0 };
}

export function scrollResult(state: TuiState, delta: number, total: number, page: number): TuiState {
  const max = Math.max(0, total - page);
  return { ...state, scroll: Math.min(max, Math.max(0, state.scroll + delta)) };
}

export function back(state: TuiState): TuiState {
  if (state.mode === 'browse') return { ...state, filter: '', cursor: 0 };
  return { ...state, mode: 'browse', input: '', error: undefined, scroll: 0 };
}

function clamp(cursor: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(cursor, count - 1);
}
