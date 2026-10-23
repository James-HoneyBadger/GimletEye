import './styles/tokens.css';
import './styles/app.css';

import { fetchHealth, fetchPacks, fetchTools, runTool } from './lib/api';
import { persist, state } from './lib/store';
import { renderSidebar } from './components/sidebar';
import { renderTopbar } from './components/topbar';
import { renderWorkbench } from './components/workbench';
import { renderResult } from './components/result';
import { icons } from './components/icons';
import { modLabel } from './lib/format';

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
    </div>`;
  restoreSidebarScroll(offset, true);
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

function renderResultOnly(): void {
  const region = root.querySelector('#result-region');
  if (!region) {
    renderAll();
    return;
  }
  region.innerHTML = renderResult(state);
}

function toast(message: string, tone: 'ok' | 'error' = 'ok'): void {
  const stack = root.querySelector('#toasts');
  if (!stack) return;
  const element = document.createElement('div');
  element.className = `toast toast--${tone}`;
  element.textContent = message;
  stack.append(element);
  window.setTimeout(() => element.classList.add('toast--out'), 2200);
  window.setTimeout(() => element.remove(), 2600);
}

function selectTool(id: string): void {
  if (state.selectedId === id) return;
  state.selectedId = id;
  state.report = null;
  state.error = null;
  state.tab = 'details';
  persist();
  renderAll();
}

function toggleTheme(): void {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  persist();
  renderAll();
}

function focusSearch(): void {
  const search = root.querySelector<HTMLInputElement>('#search');
  search?.focus();
  search?.select();
}

function setRunning(running: boolean): void {
  const button = root.querySelector<HTMLButtonElement>('#run');
  if (!button) return;
  button.disabled = running;
  button.innerHTML = running
    ? '<span class="spinner" aria-hidden="true"></span>Running…'
    : `${icons.play}Run`;
}

function collectArgs(): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-type]')) {
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      args[input.name] = input.checked;
      continue;
    }
    if (!input.value) continue;
    args[input.name] = input.dataset.type === 'integer' ? Number(input.value) : input.value;
  }
  return args;
}

async function run(): Promise<void> {
  const tool = state.tools.find((candidate) => candidate.id === state.selectedId);
  if (!tool || state.running) return;

  const args = collectArgs();
  const dryRun = state.dryRun;

  state.running = true;
  state.error = null;
  state.report = null;
  state.tab = 'details';
  setRunning(true);
  renderResultOnly();

  try {
    state.report = await runTool(tool.id, args, dryRun);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
    setRunning(false);
    renderResultOnly();
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Could not copy to clipboard', 'error');
  }
}

async function boot(): Promise<void> {
  renderAll();
  try {
    const [health, tools, packs] = await Promise.all([fetchHealth(), fetchTools(), fetchPacks()]);
    state.health = health;
    state.tools = tools;
    state.packs = packs;
    if (!state.selectedId || !tools.some((tool) => tool.id === state.selectedId)) {
      state.selectedId = tools[0]?.id ?? null;
    }
    state.error = null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  renderAll();
}

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const toolButton = target.closest<HTMLElement>('[data-tool]');
  if (toolButton?.dataset.tool) {
    selectTool(toolButton.dataset.tool);
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
    void copyText(copy.dataset.copy ?? '');
    return;
  }

  if (target.closest('#toggle-theme')) {
    toggleTheme();
    return;
  }

  if (target.closest('#run')) {
    void run();
    return;
  }

  if (target.closest('#retry')) {
    void boot();
  }
});

root.addEventListener('input', (event) => {
  const target = event.target as HTMLElement;
  if (target.id === 'search' && target instanceof HTMLInputElement) {
    state.query = target.value;
    renderSidebarOnly();
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

  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    focusSearch();
    return;
  }

  if (mod && event.key === 'Enter') {
    event.preventDefault();
    void run();
    return;
  }

  if (event.key === 'Enter' && target instanceof HTMLInputElement && target.id === 'search') {
    const first = root.querySelector<HTMLElement>('[data-tool]');
    if (first?.dataset.tool) {
      selectTool(first.dataset.tool);
    }
    return;
  }

  if (event.key === 'Escape' && target instanceof HTMLInputElement && target.id === 'search') {
    if (state.query) {
      target.value = '';
      state.query = '';
      renderSidebarOnly();
    } else {
      target.blur();
    }
  }
});

void boot();
