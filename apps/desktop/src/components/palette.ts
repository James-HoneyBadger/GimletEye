import type { PaletteItem } from '../lib/palette';
import { escapeHtml } from '../lib/format';
import type { AppState } from '../lib/store';
import { icons } from './icons';

function row(item: PaletteItem, index: number, active: boolean): string {
  return `
    <li class="palette-item${active ? ' is-active' : ''}" id="palette-item-${index}"
        role="option" aria-selected="${active}" data-palette-index="${index}">
      <span class="palette-kind" aria-hidden="true">${item.kind === 'tool' ? icons.layers : icons.terminal}</span>
      <span class="palette-text">
        <span class="palette-title">${escapeHtml(item.title)}</span>
        <span class="palette-detail">${escapeHtml(item.detail)}</span>
      </span>
      ${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ''}
    </li>`;
}

/** The list alone, so typing can replace it without touching the input. */
export function renderPaletteResults(items: PaletteItem[], index: number): string {
  if (items.length === 0) {
    return `<p class="palette-empty">Nothing matches. Try a tool name, an argument, or “settings”.</p>`;
  }
  const active = Math.min(Math.max(index, 0), items.length - 1);
  return `<ul class="palette-list" id="palette-list" role="listbox" aria-label="Commands">
      ${items.map((item, at) => row(item, at, at === active)).join('')}
    </ul>`;
}

export function renderPalette(state: AppState, items: PaletteItem[]): string {
  if (!state.palette.open) return '';
  const active = Math.min(Math.max(state.palette.index, 0), Math.max(items.length - 1, 0));
  return `
    <div class="palette-backdrop" data-palette-backdrop>
      <section class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="palette-field">
          ${icons.search}
          <input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list"
                 aria-autocomplete="list" aria-activedescendant="palette-item-${active}"
                 placeholder="Search tools and actions" spellcheck="false" autocomplete="off"
                 value="${escapeHtml(state.palette.query)}" aria-label="Command palette" />
          <kbd>Esc</kbd>
        </div>
        <div id="palette-results">${renderPaletteResults(items, active)}</div>
        <footer class="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> choose</span>
          <span class="muted">${items.length} ${items.length === 1 ? 'entry' : 'entries'}</span>
        </footer>
      </section>
    </div>`;
}
