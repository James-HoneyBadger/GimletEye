import './styles/tokens.css';
import './styles/app.css';

import { createActions, FOCUSABLE, type Renderer } from './lib/actions';
import { modLabel } from './lib/format';
import { persist, state } from './lib/store';
import { renderSidebar } from './components/sidebar';
import { renderTopbar } from './components/topbar';
import { renderWorkbench } from './components/workbench';
import { renderResult } from './components/result';
import { renderSheets } from './components/sheets';
import { icons } from './components/icons';

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) {
  throw new Error('missing #app root');
}
const root: HTMLDivElement = mount;

document.documentElement.dataset.mod = modLabel;

function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', state.theme === 'dark' ? '#100e0c' : '#f6f4f0');
  }
}

function renderAll(): void {
  applyTheme();
  const offset = sidebarScroll();
  root.innerHTML = `
    <div class="app">
      ${renderTopbar(state)}
      <div class="body">
        ${renderSidebar(state)}
        ${renderWorkbench(state)}
      </div>
      <div class="toast-stack" id="toasts" aria-live="polite"></div>
      <div id="sheet-root"></div>
    </div>`;
  restoreSidebarScroll(offset, true);
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

/** Sidebar only — used while typing in search so focus is never stolen. */
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

/** Result only — used for tab switches and run completion. */
function renderResultOnly(): void {
  const region = root.querySelector('#result-region');
  if (!region) {
    renderAll();
    return;
  }
  region.innerHTML = renderResult(state);
}

/** Workbench only — used when validation messages change. */
function renderWorkbenchOnly(): void {
  const main = root.querySelector('.main');
  if (!main) {
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
  applyTheme();
  const toggle = root.querySelector<HTMLElement>('#toggle-theme');
  if (toggle) {
    toggle.innerHTML = state.theme === 'dark' ? icons.sun : icons.moon;
    toggle.setAttribute('title', `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`);
  }
  const badge = root.querySelector<HTMLElement>('#show-history span');
  if (badge) badge.textContent = state.history.length > 0 ? String(state.history.length) : '';
}

function renderSheetHost(): void {
  const host = root.querySelector('#sheet-root');
  if (host) host.innerHTML = renderSheets(state);
}

const render: Renderer = {
  all: renderAll,
  sidebar: renderSidebarOnly,
  workbench: renderWorkbenchOnly,
  result: renderResultOnly,
  sheets: renderSheetHost,
  chrome: renderChrome,
};

const actions = createActions(root, render);

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  // A tool link inside a sheet must win over the sheet's close handler.
  const toolButton = target.closest<HTMLElement>('[data-tool]');
  if (toolButton?.dataset.tool) {
    // `detail === 0` means the click came from the keyboard (Enter or Space).
    actions.selectTool(toolButton.dataset.tool, event.detail === 0);
    return;
  }

  const filter = target.closest<HTMLElement>('[data-category]');
  if (filter) {
    state.category = filter.dataset.category || null;
    persist();
    renderAll();
    return;
  }

  const tab = target.closest<HTMLElement>('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab === 'json' ? 'json' : 'details';
    renderResultOnly();
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
  if (sheetTrigger?.dataset.sheet === 'packs' || sheetTrigger?.dataset.sheet === 'history') {
    actions.openSheet(sheetTrigger.dataset.sheet);
    return;
  }

  if (target.closest('[data-clear-search]')) {
    actions.clearSearch();
    return;
  }

  if (target.closest('#toggle-theme')) {
    actions.toggleTheme();
    return;
  }

  if (target.closest('#run')) {
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

root.addEventListener('input', (event) => {
  const target = event.target as HTMLElement;
  if (target.id === 'search' && target instanceof HTMLInputElement) {
    state.query = target.value;
    renderSidebarOnly();
    return;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
    if (target.dataset.type) {
      actions.rememberDraft();
      actions.clearFieldError(target.name);
    }
  }
});

root.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.id === 'dry-run') {
    state.dryRun = target.checked;
    persist();
    return;
  }

  if (target.dataset.type === 'boolean') {
    const text = target.closest('.switch')?.querySelector('.switch-text');
    if (text) text.textContent = target.checked ? 'Enabled' : 'Disabled';
  }
});

root.addEventListener('keydown', (event) => {
  const mod = event.metaKey || event.ctrlKey;
  const target = event.target as HTMLElement;
  const inSidebar = target.closest('.sidebar') !== null;

  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    actions.focusSearch();
    return;
  }

  if (mod && event.key === 'Enter') {
    event.preventDefault();
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
    if (target instanceof HTMLInputElement && target.id === 'search') {
      if (state.query) {
        actions.clearSearch();
      } else {
        target.blur();
      }
    }
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (inSidebar || target.id === 'search') {
      event.preventDefault();
      actions.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
    }
    return;
  }

  if (event.key === 'Enter' && target instanceof HTMLInputElement && target.id === 'search') {
    event.preventDefault();
    const first = root.querySelector<HTMLElement>('.tool');
    if (first?.dataset.tool) actions.selectTool(first.dataset.tool, true);
  }
});

void actions.boot();
