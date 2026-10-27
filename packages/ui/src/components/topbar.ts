import { escapeHtml, modLabel } from '../lib/format';
import type { AppState } from '../lib/store';
import { icons } from './icons';

export function renderTopbar(state: AppState): string {
  const connected = state.health !== null;
  const status = connected
    ? `<span class="dot dot--ok"></span><span>Connected</span><span class="muted">v${escapeHtml(state.health?.version)}</span>`
    : state.error
      ? `<span class="dot dot--error"></span><span>Offline</span>`
      : `<span class="dot dot--pending"></span><span>Connecting…</span>`;

  const packCount = state.packs.length;
  const runCount = state.history.length;

  return `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">M</span>
        <span class="brand-name">Gimlet<em>Eye</em></span>
      </div>

      <div class="search" role="search">
        ${icons.search}
        <input id="search" type="search" spellcheck="false" autocomplete="off"
               placeholder="Search tools, tags, capabilities, arguments"
               aria-label="Search tools"
               value="${escapeHtml(state.query)}" />
        <kbd>${modLabel} K</kbd>
      </div>

      <div class="topbar-actions">
        <span class="conn" title="${connected ? 'API reachable' : 'API unreachable'}">${status}</span>
        <button class="icon-button icon-button--labelled" id="show-packs" type="button"
                data-sheet="packs" title="Loaded packs" aria-label="Show loaded packs">
          ${icons.layers}<span>${packCount}</span>
        </button>
        <button class="icon-button icon-button--labelled" id="show-history" type="button"
                data-sheet="history" title="Recent runs" aria-label="Show recent runs">
          ${icons.clock}<span>${runCount || ''}</span>
        </button>
        <button class="icon-button" id="toggle-theme" type="button"
                title="Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme"
                aria-label="Toggle theme">
          ${state.theme === 'dark' ? icons.sun : icons.moon}
        </button>
      </div>
    </header>
  `;
}
