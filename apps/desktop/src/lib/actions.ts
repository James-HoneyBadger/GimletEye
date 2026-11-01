import { fetchAudit, fetchDoctor, fetchHealth, fetchTools, pickPath, revealPath, runTool, type Report, type Severity } from './engine';
import { readForm } from './args';
import { copyText } from './clipboard';
import { paletteItems, rankPalette, stepIndex, actionOf, type PaletteItem } from './palette';
import { canRun, resolveRunValues, runInput } from './run';
import {
  categories,
  draftFor,
  forgetTool,
  persist,
  rememberReport,
  saveDraft,
  selectedTool,
  state,
  togglePin,
  touchRecent,
  type Density,
  type ReportTab,
  type Sheet,
  type View,
} from './store';

/** The render passes the shell owns; actions never touch markup directly. */
export interface Renderer {
  all(): void;
  workbench(): void;
  report(): void;
  sidebar(): void;
  sheets(): void;
  palette(): void;
  chrome(): void;
}

export interface Actions {
  boot(): Promise<void>;
  /** `fromKeyboard` keeps focus in the list; a pointer selection moves to the form. */
  selectTool(id: string, fromKeyboard?: boolean): void;
  /** Narrow to a pillar and open its first tool: what the empty-state cards do. */
  openCategory(category: string | null): void;
  /** Retry a failed boot, from the empty screen's error. */
  retry(): void;
  moveSelection(delta: number): void;
  toggleTheme(): void;
  toggleDensity(): void;
  setDensity(density: Density): void;
  togglePin(toolId: string): void;
  run(): Promise<void>;
  copy(text: string): Promise<void>;
  download(toolId: string): void;
  openSheet(sheet: Sheet): void;
  closeSheet(): void;
  refreshHistory(): Promise<void>;
  refreshDoctor(): Promise<void>;
  /** The palette is the search: opening it is how a tool is found. */
  openPalette(): void;
  closePalette(restoreFocus?: boolean): void;
  setPaletteQuery(query: string): void;
  movePalette(delta: number): void;
  acceptPalette(index?: number): void;
  paletteEntries(): PaletteItem[];
  /** Run one palette entry. Ids are built in lib/palette.ts, executed here. */
  execute(item: PaletteItem): void;
  setDryRun(value: boolean): void;
  /** Open a tool with values a finding or a report suggested. */
  applySuggestion(toolId: string, args: Record<string, string>): void;
  setView(view: View): void;
  setReportTab(tab: ReportTab): void;
  setFindingFilter(severity: Severity | null): void;
  sortReport(column: string): void;
  pick(mode: 'file' | 'directory' | 'either'): Promise<string | null>;
  reveal(path: string): Promise<void>;
  rememberDraft(): void;
  clearFieldError(name: string): void;
}

function visibleTools(): string[] {
  return state.tools
    .filter((tool) => !state.category || tool.category === state.category)
    .map((tool) => tool.id);
}

/** Elements a dialog may hand focus to, in document order. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createActions(root: HTMLElement, render: Renderer): Actions {
  // Focus is a modal concern: a sheet takes it on open and gives it back on close.
  let sheetReturnFocus: HTMLElement | null = null;
  let paletteReturnFocus: HTMLElement | null = null;

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

  const focusFirstField = (): void => {
    const button = root.querySelector<HTMLButtonElement>('#run');
    if (button) {
      button.focus({ preventScroll: true });
      return;
    }
    const field = root.querySelector<HTMLElement>('#args [data-type]');
    field?.focus({ preventScroll: true });
  };

  const focusFirstError = (): void => {
    const first = root.querySelector<HTMLElement>('.input--invalid, .field--enum select[aria-invalid="true"]');
    first?.focus();
  };

  /** Actions and tools, in the order the palette shows them. */
  const palette = {
    entries(): PaletteItem[] {
      return paletteItems(state.tools, {
        tool: selectedTool(),
        hasReport: state.selectedId !== null && state.reports.has(state.selectedId),
        dryRun: state.dryRun,
        theme: state.theme,
        density: state.density,
        categories: categories(),
      });
    },
  };

  return {
    async boot(): Promise<void> {
      try {
        const [health, tools] = await Promise.all([fetchHealth(), fetchTools()]);
        state.health = health;
        state.tools = tools;
        for (const id of [...state.recents, ...state.pins]) {
          if (!tools.some((tool) => tool.id === id)) forgetTool(id);
        }
        state.pins = state.pins.filter((id) => tools.some((tool) => tool.id === id));
        // A remembered tool is restored; a first run lands on the pillar screen,
        // which is where "System / Crypto / Privacy" are chosen from. Picking a
        // tool for the user made those three look decorative.
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
      render.all();
      if (state.error === null) void this.refreshHistory();
    },

    retry(): void {
      state.error = null;
      render.all();
      void this.boot();
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
      state.view = 'compose';
      state.reportTab = 'findings';
      state.reportSort = null;
      state.findingFilter = null;
      persist();
      render.all();
      if (fromKeyboard) {
        focusActiveTool();
      } else {
        focusFirstField();
      }
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
      if (state.sheet !== null) render.sheets();
    },

    toggleDensity(): void {
      this.setDensity(state.density === 'compact' ? 'comfortable' : 'compact');
    },

    applySuggestion(toolId: string, args: Record<string, string>): void {
      saveDraft(toolId, { ...args });
      this.selectTool(toolId);
    },

    setDryRun(value: boolean): void {
      state.dryRun = value;
      persist();
      render.workbench();
    },

    setDensity(density: Density): void {
      state.density = density;
      persist();
      render.chrome();
      if (state.sheet !== null) render.sheets();
    },

    togglePin(toolId: string): void {
      const pinned = togglePin(toolId);
      persist();
      render.sidebar();
      render.workbench();
      toast(pinned ? 'Pinned' : 'Unpinned');
    },

    async run(): Promise<void> {
      const tool = selectedTool();
      if (!canRun(tool, state.running)) return;

      // In the report view the form is gone; the draft is what the run used.
      const { values, fromForm } = resolveRunValues(root, draftFor(tool.id));
      if (fromForm) saveDraft(tool.id, values);

      const input = runInput(tool, values, state.dryRun);
      if (Object.keys(input.errors).length > 0) {
        state.errors = input.errors;
        render.workbench();
        focusFirstError();
        toast('Fill in the highlighted fields', 'error');
        return;
      }

      const { payload, dryRun, command } = input;

      state.errors = {};
      state.error = null;
      state.reportTab = 'findings';
      state.reportSort = null;
      state.findingFilter = null;
      state.running = true;
      // The report is the destination of a run, so the window goes there before
      // the work finishes and shows progress in place rather than a spinner in a
      // corner the eye has already left.
      state.view = 'report';
      render.all();

      try {
        const report: Report = await runTool(tool.id, payload, dryRun);
        rememberReport(tool.id, report, command);
        touchRecent(tool.id);
        persist();
        state.historyLoaded = false;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.running = false;
        render.all();
        render.chrome();
        // The trail now has this run: refresh it so the catalogue and the clock
        // agree with what just happened.
        void this.refreshHistory();
        // The form the button lived in is gone; land the reader on the report.
        root.querySelector<HTMLElement>('.report-head h1')?.focus();
      }
    },

    async copy(text: string): Promise<void> {
      try {
        await copyText(text);
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
      if (sheet === 'diagnostics') void this.refreshDoctor();
      root.querySelector<HTMLElement>('[data-sheet-panel] .icon-button')?.focus();
    },

    closeSheet(): void {
      if (!state.sheet) return;
      state.sheet = null;
      render.sheets();
      restoreFocus();
    },

    /** Read the settings the diagnostics sheet shows, rather than trusting boot. */
    async refreshDoctor(): Promise<void> {
      try {
        state.doctor = await fetchDoctor();
      } catch {
        state.doctor = null;
      }
      if (state.sheet === 'diagnostics') render.sheets();
    },

    async refreshHistory(): Promise<void> {
      try {
        const trail = await fetchAudit(50);
        state.history = trail.entries;
        state.auditPath = trail.path;
        state.historyEnabled = trail.enabled;
        state.historyLoaded = true;
      } catch {
        state.history = [];
        state.historyLoaded = true;
      }
      render.chrome();
      // The catalogue says when each tool last ran, so it follows the trail.
      render.sidebar();
      if (state.sheet === 'history') render.sheets();
    },

    openPalette(): void {
      if (state.palette.open) return;
      paletteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      state.palette = { open: true, query: '', index: 0 };
      render.palette();
    },

    closePalette(restoreFocusToTrigger = true): void {
      if (!state.palette.open) return;
      state.palette = { open: false, query: '', index: 0 };
      render.palette();
      if (restoreFocusToTrigger && paletteReturnFocus?.isConnected) paletteReturnFocus.focus();
      paletteReturnFocus = null;
    },

    setPaletteQuery(query: string): void {
      state.palette.query = query;
      state.palette.index = 0;
      render.palette();
    },

    movePalette(delta: number): void {
      const entries = this.paletteEntries();
      if (entries.length === 0) return;
      const next = stepIndex(state.palette.index, delta, entries.length);
      state.palette.index = next;
      render.palette();
      root.querySelector<HTMLElement>(`#palette-item-${next}`)?.scrollIntoView({ block: 'nearest' });
    },

    acceptPalette(index?: number): void {
      const entries = rankPalette(palette.entries(), state.palette.query);
      const wanted = index ?? state.palette.index;
      const chosen = entries[stepIndex(wanted, 0, entries.length)] ?? entries[0];
      if (!chosen) return;
      this.closePalette(true);
      this.execute(chosen);
    },

    paletteEntries(): PaletteItem[] {
      return rankPalette(palette.entries(), state.palette.query);
    },

    setView(view: View): void {
      state.view = view;
      render.all();
      // The control that was clicked is gone; put focus where the next action is.
      if (view === 'report') root.querySelector<HTMLElement>('.report-head h1')?.focus();
      else focusFirstField();
    },

    setReportTab(tab: ReportTab): void {
      state.reportTab = tab;
      render.report();
    },

    setFindingFilter(severity: Severity | null): void {
      state.findingFilter = severity;
      render.report();
    },

    sortReport(column: string): void {
      const current = state.reportSort;
      state.reportSort =
        current && current.column === column && current.direction === 1
          ? { column, direction: -1 }
          : { column, direction: 1 };
      render.report();
    },

    async pick(mode: 'file' | 'directory' | 'either'): Promise<string | null> {
      try {
        return await pickPath(mode);
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error');
        return null;
      }
    },

    async reveal(path: string): Promise<void> {
      try {
        await revealPath(path);
        toast('Opened in the file manager');
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error');
      }
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

    /** Run one palette entry. Ids are built in lib/palette.ts, parsed there too. */
    execute(item: PaletteItem): void {
      const target = actionOf(item);
      if (target.kind === 'tool') {
        this.selectTool(target.id);
        return;
      }
      const action = target.name;
      if (action === 'run') void this.run();
      else if (action === 'dry-run') this.setDryRun(!state.dryRun);
      else if (action === 'edit') this.setView('compose');
      else if (action === 'copy-cli') {
        const command = state.selectedId ? state.runs.get(state.selectedId) : undefined;
        if (command) void this.copy(command);
      } else if (action === 'pin') {
        if (state.selectedId) this.togglePin(state.selectedId);
      } else if (action === 'theme') this.toggleTheme();
      else if (action === 'density') this.toggleDensity();
      else if (action === 'history') this.openSheet('history');
      else if (action === 'diagnostics') this.openSheet('diagnostics');
      else if (action === 'shortcuts') this.openSheet('shortcuts');
      else if (action.startsWith('category:')) this.openCategory(action.slice('category:'.length));
    },
  };
}
