import {
  fetchAudit,
  fetchHealth,
  fetchPacks,
  fetchTools,
  runTool,
  setApiToken,
  UnauthorizedError,
  type Report,
} from './api';
import { readForm, toPayload, validateArgs } from './args';
import { cliCommand, matchesQuery } from './format';
import { icons } from '../components/icons';
import {
  forgetTool,
  persist,
  rememberReport,
  saveDraft,
  selectedTool,
  state,
  type Sheet,
} from './store';

/** The render passes the shell owns; actions never touch markup directly. */
export interface Renderer {
  all(): void;
  workbench(): void;
  result(): void;
  sidebar(): void;
  sheets(): void;
  chrome(): void;
}

export interface Actions {
  boot(): Promise<void>;
  /** Store a token the user pasted and retry the boot. */
  submitToken(value: string): Promise<void>;
  /** `fromKeyboard` keeps focus in the list; a pointer selection moves to the form. */
  selectTool(id: string, fromKeyboard?: boolean): void;
  /** Narrow to a pillar and open its first tool: what the empty-state cards do. */
  openCategory(category: string | null): void;
  moveSelection(delta: number): void;
  toggleTheme(): void;
  run(): Promise<void>;
  copy(text: string): Promise<void>;
  download(toolId: string): void;
  openSheet(sheet: Sheet): void;
  closeSheet(): void;
  refreshHistory(): Promise<void>;
  focusSearch(): void;
  clearSearch(): void;
  rememberDraft(): void;
  clearFieldError(name: string): void;
}

function visibleTools(): string[] {
  return state.tools
    .filter((tool) => !state.category || tool.category === state.category)
    .filter((tool) => matchesQuery(tool, state.query))
    .map((tool) => tool.id);
}

/** Elements a dialog may hand focus to, in document order. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createActions(root: HTMLElement, render: Renderer): Actions {
  // Focus is a modal concern: a sheet takes it on open and gives it back on close.
  let sheetReturnFocus: HTMLElement | null = null;

  const restoreFocus = (): void => {
    const previous = sheetReturnFocus;
    sheetReturnFocus = null;
    if (previous?.isConnected) previous.focus();
  };

  const toast = (message: string, tone: 'ok' | 'error' = 'ok'): void => {
    const stack = root.querySelector('#toasts');
    if (!stack) return;
    const element = document.createElement('div');
    element.className = `toast toast--${tone}`;
    element.textContent = message;
    stack.append(element);
    window.setTimeout(() => element.classList.add('toast--out'), 2200);
    window.setTimeout(() => element.remove(), 2600);
  };

  const focusActiveTool = (): void => {
    root.querySelector<HTMLElement>('.tool--active')?.focus({ preventScroll: true });
  };

  const setRunning = (running: boolean): void => {
    const button = root.querySelector<HTMLButtonElement>('#run');
    if (!button) return;
    button.disabled = running;
    button.innerHTML = running
      ? '<span class="spinner" aria-hidden="true"></span>Running…'
      : `${icons.play}Run`;
  };

  const focusFirstError = (): void => {
    const first = root.querySelector<HTMLElement>('.input--invalid, .field--enum select[aria-invalid="true"]');
    first?.focus();
  };

  /** After choosing a tool with the pointer, continue into its form. */
  const focusFirstField = (): void => {
    const field = root.querySelector<HTMLElement>('#args [data-type]') ?? root.querySelector<HTMLElement>('#run');
    field?.focus({ preventScroll: true });
  };

  return {
    async boot(): Promise<void> {
      render.all();
      try {
        const [health, tools, packs] = await Promise.all([fetchHealth(), fetchTools(), fetchPacks()]);
        state.health = health;
        state.tools = tools;
        state.packs = packs;
        const known = new Set(tools.map((tool) => tool.id));
        const cached = new Set([...state.reports.keys(), ...state.drafts.keys()]);
        for (const id of cached) {
          if (!known.has(id)) forgetTool(id);
        }
        if (state.selectedId && !known.has(state.selectedId)) {
          state.selectedId = null;
        }
        // A remembered tool is restored; a first run lands on the pillar screen,
        // which is where "System / Crypto / Privacy" are chosen from. Picking a
        // tool for the user made those three look decorative.
        state.error = null;
        state.tokenRequired = false;
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          state.tokenRequired = true;
          state.error = null;
        } else {
          state.tokenRequired = false;
          state.error = error instanceof Error ? error.message : String(error);
        }
      }
      render.all();
      if (!state.tokenRequired) void this.refreshHistory();
    },

    async submitToken(value: string): Promise<void> {
      setApiToken(value);
      state.tokenRequired = false;
      state.error = null;
      await this.boot();
      if (state.tokenRequired) toast('That token was not accepted', 'error');
    },

    openCategory(category: string | null): void {
      state.category = category;
      persist();
      const first = visibleTools()[0];
      if (first && first !== state.selectedId) {
        this.selectTool(first);
        return;
      }
      render.all();
    },

    selectTool(id: string, fromKeyboard = false): void {
      const changed = state.selectedId !== id;
      const hadSheet = state.sheet !== null;
      state.sheet = null;
      if (!changed) {
        render.sheets();
        if (hadSheet) restoreFocus();
        return;
      }
      state.selectedId = id;
      state.errors = {};
      state.error = null;
      state.tab = 'details';
      persist();
      render.all();
      if (fromKeyboard) {
        focusActiveTool();
      } else {
        focusFirstField();
      }
    },

    moveSelection(delta: number): void {
      const ids = visibleTools();
      if (ids.length === 0) return;
      const current = state.selectedId ? ids.indexOf(state.selectedId) : -1;
      const next = Math.min(Math.max(current + delta, 0), ids.length - 1);
      if (ids[next] !== state.selectedId) this.selectTool(ids[next], true);
    },

    toggleTheme(): void {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      persist();
      render.chrome();
    },

    async run(): Promise<void> {
      const tool = selectedTool();
      if (!tool || state.running) return;

      const values = readForm(root);
      saveDraft(tool.id, values);
      const errors = validateArgs(tool, values);
      if (Object.keys(errors).length > 0) {
        state.errors = errors;
        render.workbench();
        focusFirstError();
        toast('Fill in the highlighted fields', 'error');
        return;
      }

      const dryRun = tool.mutates ? state.dryRun : false;
      const payload = toPayload(tool, values);
      const command = cliCommand(tool.id, payload, dryRun);

      state.errors = {};
      state.error = null;
      state.tab = 'details';
      state.running = true;
      setRunning(true);
      render.result();

      try {
        const report: Report = await runTool(tool.id, payload, dryRun);
        rememberReport(tool.id, report, command);
        state.historyLoaded = false;
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          state.tokenRequired = true;
          await this.boot();
        } else {
          state.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        state.running = false;
        setRunning(false);
        render.result();
        render.chrome();
      }
    },

    async copy(text: string): Promise<void> {
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard');
      } catch {
        toast('Could not copy to clipboard', 'error');
      }
    },

    download(toolId: string): void {
      const report = state.reports.get(toolId);
      if (!report) return;
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${toolId.replace(/[^\w.-]+/g, '-')}-report.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast('Report downloaded');
    },

    openSheet(sheet: Sheet): void {
      sheetReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      state.sheet = sheet;
      render.sheets();
      if (sheet === 'history' && !state.historyLoaded) void this.refreshHistory();
      root.querySelector<HTMLElement>('[data-sheet-panel] .icon-button')?.focus();
    },

    closeSheet(): void {
      if (!state.sheet) return;
      state.sheet = null;
      render.sheets();
      restoreFocus();
    },

    async refreshHistory(): Promise<void> {
      try {
        const trail = await fetchAudit(50);
        state.history = trail.entries;
        state.historyEnabled = trail.enabled;
        state.historyLoaded = true;
      } catch {
        state.history = [];
        state.historyLoaded = true;
      }
      render.chrome();
      if (state.sheet === 'history') render.sheets();
    },

    focusSearch(): void {
      const search = root.querySelector<HTMLInputElement>('#search');
      search?.focus();
      search?.select();
    },

    clearSearch(): void {
      state.query = '';
      const search = root.querySelector<HTMLInputElement>('#search');
      if (search) search.value = '';
      render.sidebar();
    },

    /** Persist the form as the user types so a tool switch is not destructive. */
    rememberDraft(): void {
      const tool = selectedTool();
      if (tool) saveDraft(tool.id, readForm(root));
    },

    clearFieldError(name: string): void {
      if (!state.errors[name]) return;
      delete state.errors[name];
      const message = root.querySelector<HTMLElement>(`[name="${name}"]`);
      message?.removeAttribute('aria-invalid');
      message?.removeAttribute('aria-describedby');
      message?.classList.remove('input--invalid');
      root.querySelector(`#arg-${name}-error`)?.remove();
    },
  };
}
