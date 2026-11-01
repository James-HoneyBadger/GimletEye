import { escapeHtml, modLabel } from '../lib/format';
import type { AppState } from '../lib/store';
import { icons } from './icons';

export function renderTopbar(state: AppState): string {
  const connected = state.health !== null;
  const status = connected
    ? `<span class="dot dot--ok"></span><span>Ready</span><span class="muted">v${escapeHtml(state.health?.version)}</span>`
    : state.error
      ? `<span class="dot dot--error"></span><span>Unavailable</span>`
      : `<span class="dot dot--pending"></span><span>Starting…</span>`;

  const runCount = state.history.length;

  return `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">G</span>
        <span class="brand-name">Gimlet<em>Eye</em></span>
      </div>

      <button class="search search--trigger" id="open-palette" type="button" data-palette-open
              title="Search tools and actions" aria-label="Search tools and actions"
              aria-keyshortcuts="Control+K Meta+K">
        ${icons.search}
        <span class="search-placeholder">Search tools and actions</span>
        <kbd>${modLabel} K</kbd>
      </button>

      <div class="topbar-actions">
        <span class="conn" title="${connected ? 'Engine ready' : 'Engine unavailable'}">${status}</span>
        <button class="icon-button icon-button--labelled" id="show-history" type="button"
                data-sheet="history" title="Recent runs" aria-label="Show recent runs">
          ${icons.clock}<span>${runCount || ''}</span>
        </button>
        <button class="icon-button" id="toggle-theme" type="button"
                title="Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme"
                aria-label="Toggle theme">
          ${state.theme === 'dark' ? icons.sun : icons.moon}
        </button>
        <button class="icon-button" id="open-settings" type="button"
                data-sheet="diagnostics" title="Settings and diagnostics" aria-label="Settings and diagnostics">
          ${icons.gear}
        </button>
      </div>
    </header>
  `;
}
