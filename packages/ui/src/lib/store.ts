import type { Health, PackSummary, Report, ToolManifest } from './api';

export type Tab = 'details' | 'json';
export type Theme = 'dark' | 'light';

export interface AppState {
  tools: ToolManifest[];
  packs: PackSummary[];
  health: Health | null;
  selectedId: string | null;
  query: string;
  category: string | null;
  report: Report | null;
  error: string | null;
  running: boolean;
  dryRun: boolean;
  theme: Theme;
  tab: Tab;
}

const STORAGE_KEY = 'mellivora.ui.v1';

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
  report: null,
  error: null,
  running: false,
  dryRun: saved.dryRun ?? false,
  theme: saved.theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  tab: 'details',
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

export function categories(): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tool of state.tools) {
    counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
