import type { AuditEntry, Health, PackSummary, Report, ToolManifest } from './api';

/** Form state exactly as typed: strings for text/number inputs, booleans for switches. */
export type RawValues = Record<string, string | boolean>;

export type Tab = 'details' | 'json';
export type Theme = 'dark' | 'light';
export type Sheet = 'packs' | 'history' | null;

export interface AppState {
  tools: ToolManifest[];
  packs: PackSummary[];
  health: Health | null;
  selectedId: string | null;
  query: string;
  category: string | null;
  /** Last report per tool, so switching away and back is not a reset. */
  reports: Map<string, Report>;
  /** The CLI command that produced each cached report. */
  runs: Map<string, string>;
  /** In-progress form values per tool, so switching tools is not destructive. */
  drafts: Map<string, RawValues>;
  error: string | null;
  /** The engine asked for a token we do not have yet. */
  tokenRequired: boolean;
  /** Per-field validation messages for the selected tool. */
  errors: Record<string, string>;
  running: boolean;
  dryRun: boolean;
  theme: Theme;
  tab: Tab;
  sheet: Sheet;
  history: AuditEntry[];
  historyEnabled: boolean;
  historyLoaded: boolean;
}

const STORAGE_KEY = 'gimlet.ui.v1';

interface Persisted {
  theme?: Theme;
  dryRun?: boolean;
  selectedId?: string | null;
  category?: string | null;
}

function loadPersisted(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Persisted;
  } catch {
    return {};
  }
}

const saved = loadPersisted();

export const state: AppState = {
  tools: [],
  packs: [],
  health: null,
  selectedId: saved.selectedId ?? null,
  query: '',
  category: saved.category ?? null,
  reports: new Map(),
  runs: new Map(),
  drafts: new Map(),
  error: null,
  tokenRequired: false,
  errors: {},
  running: false,
  dryRun: saved.dryRun ?? false,
  theme: saved.theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  tab: 'details',
  sheet: null,
  history: [],
  historyEnabled: true,
  historyLoaded: false,
};

export function persist(): void {
  const snapshot: Persisted = {
    theme: state.theme,
    dryRun: state.dryRun,
    selectedId: state.selectedId,
    category: state.category,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private browsing or a full quota: preferences are best-effort.
  }
}

export function selectedTool(): ToolManifest | null {
  return state.tools.find((tool) => tool.id === state.selectedId) ?? null;
}

/** Categories present in the registry, with the number of tools in each. */
export function categories(): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tool of state.tools) {
    counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Remember a finished report under its tool and clear any stale error. */
export function rememberReport(toolId: string, report: Report, command?: string): void {
  state.reports.set(toolId, report);
  if (command) state.runs.set(toolId, command);
  state.error = null;
}

export function reportFor(toolId: string | null): Report | null {
  return toolId ? state.reports.get(toolId) ?? null : null;
}

export function draftFor(toolId: string | null): RawValues {
  return (toolId ? state.drafts.get(toolId) : undefined) ?? {};
}

export function saveDraft(toolId: string, values: RawValues): void {
  state.drafts.set(toolId, values);
}

/** Drop everything cached for a tool, e.g. when it disappears from the registry. */
export function forgetTool(toolId: string): void {
  state.reports.delete(toolId);
  state.runs.delete(toolId);
  state.drafts.delete(toolId);
}
