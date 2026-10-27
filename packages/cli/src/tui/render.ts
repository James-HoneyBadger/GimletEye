/**
 * The frame the terminal draws.
 *
 * Pure string work with an explicit size, so a frame can be asserted in a test
 * and a narrow terminal can be exercised without resizing anything.
 */

import { render, type Report, type ToolManifest } from '@gimlet-eye/core';

import { visible, type TuiState } from './state.js';

export interface Size {
  readonly width: number;
  readonly height: number;
}

const HINT: Record<TuiState['mode'], string> = {
  browse: 'type to filter · ↑↓ move · enter run · esc clear · ctrl-c quit',
  args: 'key=value pairs, space separated · enter run · esc back',
  result: '↑↓ scroll · esc/enter back · ctrl-c quit',
};

export function renderFrame(state: TuiState, manifests: readonly ToolManifest[], size: Size): string[] {
  const width = Math.max(20, size.width);
  const body = size.height - 3;

  const lines = [header(state, manifests, width)];
  switch (state.mode) {
    case 'browse':
      lines.push(...listLines(state, manifests, width, body));
      break;
    case 'args':
      lines.push(...argumentLines(state, manifests, width, body));
      break;
    case 'result':
      lines.push(...resultLines(state, width, body));
      break;
  }
  lines.push(hint(state, width));
  return lines.map((line) => truncate(line, width));
}

function header(state: TuiState, manifests: readonly ToolManifest[], width: number): string {
  const total = manifests.length;
  const shown = visible(manifests, state.filter).length;
  const filtered = state.filter === '' ? '' : `  filter: ${state.filter}`;
  return truncate(`Gimlet Eye · ${shown}/${total} tools${filtered}`, width);
}

function listLines(
  state: TuiState,
  manifests: readonly ToolManifest[],
  width: number,
  height: number,
): string[] {
  const rows = visible(manifests, state.filter);
  if (rows.length === 0) return ['', '  no tool matches that filter'];

  // Keep the cursor in view: the window slides rather than the cursor leaving it.
  const start = Math.max(0, Math.min(state.cursor - Math.floor(height / 2), rows.length - height));
  const lines: string[] = [];
  for (let index = start; index < Math.min(rows.length, start + height); index += 1) {
    const manifest = rows[index] as ToolManifest;
    const marker = index === state.cursor ? '>' : ' ';
    const id = manifest.id.padEnd(26);
    const mutates = manifest.mutates === true ? ' [writes]' : '';
    lines.push(`${marker} ${id} ${manifest.summary}${mutates}`);
  }
  return lines;
}

function argumentLines(
  state: TuiState,
  manifests: readonly ToolManifest[],
  width: number,
  height: number,
): string[] {
  const manifest = manifests.find((candidate) => candidate.id === state.toolId);
  const lines = ['', `  ${manifest?.id ?? state.toolId ?? ''} — ${manifest?.summary ?? ''}`, ''];
  for (const arg of manifest?.args ?? []) {
    const required = arg.required === true ? 'required' : 'optional';
    const fallback = arg.default === undefined ? '' : ` default: ${String(arg.default)}`;
    const values = arg.type === 'enum' ? ` (${arg.values.join(' | ')})` : '';
    lines.push(`  ${arg.name.padEnd(18)} ${arg.type} ${required}${values}${fallback}`);
    if (arg.help !== undefined) lines.push(`  ${' '.repeat(18)} ${arg.help}`);
  }
  lines.push('', `  > ${state.input}`);
  return lines.slice(0, Math.max(1, height));
}

function resultLines(state: TuiState, width: number, height: number): string[] {
  const text = state.error !== undefined ? `error: ${state.error}\n` : render(state.report as Report, 'text');
  const all = text.trimEnd().split('\n');
  const window = all.slice(state.scroll, state.scroll + Math.max(1, height));
  if (all.length > height) window.push(`  (${state.scroll + 1}-${Math.min(all.length, state.scroll + height)} of ${all.length})`);
  return window;
}

function hint(state: TuiState, width: number): string {
  return truncate(` ${HINT[state.mode]}`, width);
}

export function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
