import './styles/tokens.css';
import './styles/app.css';

import { createActions, FOCUSABLE, type Renderer } from './lib/actions';
import { modLabel } from './lib/format';
import { shortcutFor } from './lib/shortcuts';
import { persist, state } from './lib/store';
import { renderSidebar } from './components/sidebar';
import { renderTopbar } from './components/topbar';
import { renderWorkbench } from './components/workbench';
import { renderReport } from './components/report';
import { renderPalette, renderPaletteResults } from './components/palette';
import { renderSheets } from './components/sheets';
import { icons } from './components/icons';

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) {
  throw new Error('missing #app root');
}
const root: HTMLDivElement = mount;

document.documentElement.dataset.mod = modLabel;

function applyShell(): void {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.density = state.density;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', state.theme === 'dark' ? '#100e0c' : '#f6f4f0');
  }
}

/** The main pane is one of two places: the parameters, or the report. */
function mainPane(): string {
  return state.view === 'report' ? renderReport(state) : renderWorkbench(state);
}

function renderAll(): void {
  applyShell();
  const offset = sidebarScroll();
  root.innerHTML = `
    <div class="app">
      <button class="skip-link" type="button" data-skip>Skip to the tool</button>
      ${renderTopbar(state)}
      <div class="body">
        ${renderSidebar(state)}
        ${mainPane()}
      </div>
      <div class="toast-stack" id="toasts" aria-live="polite"></div>
      <div id="palette-root"></div>
      <div id="sheet-root"></div>
    </div>`;
  restoreSidebarScroll(offset, true);
  renderPaletteHost();
  renderSheetHost();
}

function sidebarScroll(): number {
  return root.querySelector<HTMLElement>('.sidebar-scroll')?.scrollTop ?? 0;
}

function restoreSidebarScroll(offset: number, revealActive: boolean): void {
  const scroller = root.querySelector<HTMLElement>('.sidebar-scroll');
  if (!scroller) return;
  if (revealActive) {
    const active = scroller.querySelector<HTMLElement>('.tool--active');
    if (active) {
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;
      const top = active.offsetTop;
      const bottom = top + active.offsetHeight;
      if (top < viewTop || bottom > viewBottom) {
        scroller.scrollTop = Math.max(0, top - 10);
      }
      return;
    }
  }
  scroller.scrollTop = offset;
}

/** Sidebar only — used while typing in the palette so focus is never stolen. */
function renderSidebarOnly(): void {
  const current = root.querySelector('.sidebar');
  if (!current) {
    renderAll();
    return;
  }
  const offset = sidebarScroll();
  current.outerHTML = renderSidebar(state);
  restoreSidebarScroll(offset, false);
}

/** The report pane only — for tab switches, sorting, and run completion. */
function renderReportOnly(): void {
  const main = root.querySelector('.main');
  if (!main || state.view !== 'report') {
    renderAll();
    return;
  }
  const scroll = main.scrollTop;
  main.outerHTML = renderReport(state);
  const replaced = root.querySelector<HTMLElement>('.main');
  if (replaced) replaced.scrollTop = scroll;
}

/** Workbench only — used when validation messages change. */
function renderWorkbenchOnly(): void {
  const main = root.querySelector('.main');
  if (!main || state.view !== 'compose') {
    renderAll();
    return;
  }
  const scroll = main.scrollTop;
  main.outerHTML = renderWorkbench(state);
  const replaced = root.querySelector<HTMLElement>('.main');
  if (replaced) replaced.scrollTop = scroll;
}

/** Topbar affordances that change without a full re-render. */
function renderChrome(): void {
  applyShell();
  const toggle = root.querySelector<HTMLElement>('#toggle-theme');
  if (toggle) {
    toggle.innerHTML = state.theme === 'dark' ? icons.sun : icons.moon;
    toggle.setAttribute('title', `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`);
  }
  const badge = root.querySelector<HTMLElement>('#show-history span');
  if (badge) badge.textContent = state.history.length > 0 ? String(state.history.length) : '';
}

/**
 * The palette, and the input it must not lose.
 *
 * Typing re-renders the list and the sidebar underneath (the palette is also the
 * search), so the overlay is only rebuilt when it is not already on screen.
 */
function renderPaletteHost(): void {
  const host = root.querySelector('#palette-root');
  if (!host) return;
  if (!state.palette.open) {
    host.innerHTML = '';
    return;
  }
  const items = actions.paletteEntries();
  const input = host.querySelector<HTMLInputElement>('#palette-input');
  const results = host.querySelector<HTMLElement>('#palette-results');
  if (input && results) {
    results.innerHTML = renderPaletteResults(items, state.palette.index);
    input.setAttribute('aria-activedescendant', `palette-item-${state.palette.index}`);
    return;
  }
  host.innerHTML = renderPalette(state, items);
  host.querySelector<HTMLInputElement>('#palette-input')?.focus();
}

/**
 * The sheet, and the focus it owns.
 *
 * The history sheet re-renders when the audit tail arrives, which replaces the
 * control the user was on and drops focus to `<body>`. Put it back on the
 * panel, so the next Tab starts from inside the dialog rather than behind it.
 */
function renderSheetHost(): void {
  const host = root.querySelector('#sheet-root');
  if (!host) return;
  const previous = document.activeElement;
  const wasInside = previous instanceof HTMLElement && host.contains(previous);
  const wasLost = previous === null || previous === document.body;
  host.innerHTML = renderSheets(state);
  if (state.sheet === null || !(wasInside || wasLost)) return;
  host.querySelector<HTMLElement>('[data-sheet-panel] .icon-button')?.focus();
}

const render: Renderer = {
  all: renderAll,
  sidebar: renderSidebarOnly,
  workbench: renderWorkbenchOnly,
  report: renderReportOnly,
  sheets: renderSheetHost,
  palette: renderPaletteHost,
  chrome: renderChrome,
};

const actions = createActions(root, render);

/** Fill the first empty path field with a path the desktop handed back. */
function fillPath(field: string | null, path: string): void {
  const input = field
    ? root.querySelector<HTMLInputElement>(`#args [name="${field}"]`)
    : root.querySelector<HTMLInputElement>('#args input[data-type="path"]');
  if (!input) return;
  input.value = path;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  // A tool link inside a sheet must win over the sheet's close handler.
  const toolButton = target.closest<HTMLElement>('[data-tool]');
  if (toolButton?.dataset.tool) {
    // `detail === 0` means the click came from the keyboard (Enter or Space).
    actions.selectTool(toolButton.dataset.tool, event.detail === 0);
    return;
  }

  // A pillar card on the empty screen promises "go here", so it also opens the
  // first tool in that pillar. The sidebar tabs only narrow the list, because a
  // user browsing should not have the form under their cursor replaced.
  const pillar = target.closest<HTMLElement>('[data-open-category]');
  if (pillar) {
    actions.openCategory(pillar.dataset.openCategory || null);
    return;
  }

  const filter = target.closest<HTMLElement>('[data-category]');
  if (filter) {
    state.category = filter.dataset.category || null;
    persist();
    renderAll();
    return;
  }

  if (target.closest('[data-palette-open]')) {
    actions.openPalette();
    return;
  }

  const paletteRow = target.closest<HTMLElement>('[data-palette-index]');
  if (paletteRow) {
    actions.acceptPalette(Number(paletteRow.dataset.paletteIndex));
    return;
  }

  if (target.hasAttribute('data-palette-backdrop')) {
    actions.closePalette();
    return;
  }

  if (target.closest('[data-skip]')) {
    root.querySelector<HTMLElement>('#main')?.focus();
    return;
  }

  const findingFilter = target.closest<HTMLElement>('[data-finding-filter]');
  if (findingFilter) {
    const value = findingFilter.dataset.findingFilter;
    actions.setFindingFilter(value ? (value as 'info' | 'low' | 'medium' | 'high' | 'critical') : null);
    return;
  }

  const reportTab = target.closest<HTMLElement>('[data-report-tab]');
  if (reportTab?.dataset.reportTab) {
    actions.setReportTab(reportTab.dataset.reportTab as 'findings' | 'data' | 'changes' | 'raw');
    return;
  }

  const sort = target.closest<HTMLElement>('[data-sort]');
  if (sort?.dataset.sort) {
    actions.sortReport(sort.dataset.sort);
    return;
  }

  if (target.closest('[data-edit-parameters]')) {
    actions.setView('compose');
    return;
  }

  const pin = target.closest<HTMLElement>('[data-pin-tool]');
  if (pin?.dataset.pinTool) {
    actions.togglePin(pin.dataset.pinTool);
    return;
  }

  const suggestion = target.closest<HTMLElement>('[data-suggest-tool]');
  if (suggestion?.dataset.suggestTool) {
    let args: Record<string, string> = {};
    try {
      args = JSON.parse(suggestion.dataset.suggestArgs ?? '{}') as Record<string, string>;
    } catch {
      args = {};
    }
    actions.applySuggestion(suggestion.dataset.suggestTool, args);
    return;
  }

  const pick = target.closest<HTMLElement>('[data-pick]');
  if (pick?.dataset.pick) {
    const mode = pick.dataset.pick === 'directory' ? 'directory' : 'file';
    const field = pick.dataset.field ?? null;
    void actions.pick(mode).then((chosen) => {
      if (chosen !== null) fillPath(field, chosen);
    });
    return;
  }

  const reveal = target.closest<HTMLElement>('[data-reveal]');
  if (reveal?.dataset.reveal) {
    void actions.reveal(reveal.dataset.reveal);
    return;
  }

  const action = target.closest<HTMLElement>('[data-action]');
  if (action?.dataset.action) {
    actions.execute({
      id: `action:${action.dataset.action}`,
      kind: 'action',
      title: '',
      detail: '',
    });
    return;
  }

  const copy = target.closest<HTMLElement>('[data-copy]');
  if (copy) {
    void actions.copy(copy.dataset.copy ?? '');
    return;
  }

  const download = target.closest<HTMLElement>('[data-download]');
  if (download?.dataset.download) {
    actions.download(download.dataset.download);
    return;
  }

  const sheetTrigger = target.closest<HTMLElement>('[data-sheet]');
  if (sheetTrigger?.dataset.sheet) {
    actions.openSheet(sheetTrigger.dataset.sheet as 'history' | 'diagnostics' | 'shortcuts');
    return;
  }

  if (target.closest('#toggle-theme')) {
    actions.toggleTheme();
    return;
  }

  if (target.closest('[data-retry]')) {
    actions.retry();
    return;
  }

  if (target.closest('#run') || target.closest('[data-retry-run]')) {
    void actions.run();
    return;
  }

  if (target.closest('[data-sheet-close]')) {
    actions.closeSheet();
    return;
  }

  if (target.hasAttribute('data-sheet-backdrop')) {
    actions.closeSheet();
  }
});

root.addEventListener('submit', (event) => {
  // Nothing posts anywhere: a run is a call into the shared runtime, so a stray
  // Enter in a field must not reload the page.
  event.preventDefault();
});

root.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.id === 'palette-input') {
    actions.setPaletteQuery(target.value);
    return;
  }
  if (target.dataset.type) {
    actions.rememberDraft();
    actions.clearFieldError(target.name);
  }
});

root.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.id === 'dry-run') {
    actions.setDryRun(target.checked);
    return;
  }

  // A segmented control is a radio group: `change` is what fires when the
  // selection moves, and the choice has to reach the draft from here.
  if (target.type === 'radio' && target.dataset.type) {
    // Move the selected styling with the choice: doing it here rather than with
    // `:has()` keeps it correct in every webview, old ones included.
    const group = target.closest('.choice-group');
    if (group) {
      for (const choice of group.querySelectorAll('.choice')) choice.classList.remove('is-active');
      target.closest('.choice')?.classList.add('is-active');
    }
    actions.rememberDraft();
    actions.clearFieldError(target.name);
    return;
  }

  if (target.dataset.type === 'boolean') {
    const text = target.closest('.switch')?.querySelector('.switch-text');
    if (text) text.textContent = target.checked ? 'Enabled' : 'Disabled';
  }
});

// A file dragged from the desktop is a real path. The preload resolves it (the
// page cannot) and leaves the answer on the drop zone.
root.addEventListener('gimlet-works:dropped', (event) => {
  const zone = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-drop-zone]') : null;
  const path = zone?.dataset.droppedPath;
  if (!zone || !path) return;
  delete zone.dataset.droppedPath;
  zone.classList.remove('is-drop');
  const input = zone.querySelector<HTMLInputElement>('input[data-type="path"]');
  if (input) {
    input.value = path;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
});

for (const type of ['dragenter', 'dragover'] as const) {
  root.addEventListener(type, (event) => {
    const zone = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-drop-zone]') : null;
    if (!zone) return;
    event.preventDefault();
    zone.classList.add('is-drop');
  });
}

root.addEventListener('dragleave', (event) => {
  const zone = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-drop-zone]') : null;
  zone?.classList.remove('is-drop');
});

root.addEventListener('drop', (event) => {
  const zone = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-drop-zone]') : null;
  if (!zone) return;
  // The preload reads the path; the page just stops Chromium navigating.
  event.preventDefault();
});

// Keydown is bound to the document, not `#app`: focus can land on `<body>` (a
// re-rendered sheet, a dismissed control), and an event targeted there never
// reaches a listener attached to a descendant — Escape would do nothing.
document.addEventListener('keydown', (event) => {
  // A view that has been replaced must not answer for the one on screen.
  if (!root.isConnected) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const inSidebar = target?.closest('.sidebar') != null;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
  const shortcut = shortcutFor(event);

  if (shortcut === 'palette') {
    event.preventDefault();
    if (state.palette.open) actions.closePalette();
    else actions.openPalette();
    return;
  }

  if (shortcut === 'settings') {
    event.preventDefault();
    actions.openSheet('diagnostics');
    return;
  }

  if (state.palette.open) {
    if (event.key === 'Escape') {
      event.preventDefault();
      actions.closePalette();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      actions.movePalette(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      actions.acceptPalette();
      return;
    }
    if (event.key === 'Tab') {
      // The palette has one field; Tab has nowhere useful to go.
      event.preventDefault();
      return;
    }
  }

  if (shortcut === 'run' || shortcut === 'dry-run') {
    event.preventDefault();
    if (shortcut === 'dry-run' && selectedToolMutates()) actions.setDryRun(true);
    void actions.run();
    return;
  }

  if (state.sheet && event.key === 'Tab') {
    // A modal sheet keeps Tab inside it; leaving would reach the page behind.
    const panel = root.querySelector<HTMLElement>('[data-sheet-panel]');
    const items = panel ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel?.contains(active))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }

  if (event.key === 'Escape') {
    if (state.sheet) {
      event.preventDefault();
      actions.closeSheet();
      return;
    }
    if (state.view === 'report') {
      event.preventDefault();
      actions.setView('compose');
      return;
    }
    return;
  }

  if (shortcut === 'shortcuts' && !typing) {
    event.preventDefault();
    actions.openSheet('shortcuts');
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (inSidebar || target?.id === 'palette-input') {
      event.preventDefault();
      actions.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
    }
    return;
  }

});

function selectedToolMutates(): boolean {
  const id = state.selectedId;
  if (!id) return false;
  return state.tools.find((tool) => tool.id === id)?.mutates === true;
}

void actions.boot();
