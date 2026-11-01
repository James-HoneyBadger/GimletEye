import { summariseAudit, type AuditEntry } from '@gimlet-eye/core';

import type { Sort } from './data';
import type { DoctorSnapshot, Health, Report, Severity, Status, ToolManifest } from './engine';
import { PREFERENCES_KEY, readPreferences, type Preferences } from './preferences';

/** Form state exactly as typed: strings for text/number inputs, booleans for switches. */
export type RawValues = Record<string, string | boolean>;

export type ReportTab = 'findings' | 'data' | 'changes' | 'raw';
export type Theme = 'dark' | 'light';
export type Density = 'comfortable' | 'compact';
export type Sheet = 'history' | 'diagnostics' | 'shortcuts' | null;
export type View = 'compose' | 'report';

export interface PaletteState {
  open: boolean;
  query: string;
  index: number;
}

export interface AppState {
  tools: ToolManifest[];
  /** Engine status, once the runtime has loaded. */
  health: Health | null;
  /** Live diagnostics, read when the sheet is opened. */
  doctor: DoctorSnapshot | null;
  selectedId: string | null;
  category: string | null;
  /** Last report per tool, so switching away and back is not a reset. */
  reports: Map<string, Report>;
  /** The report before the last one, per tool: the baseline a diff reads. */
  previous: Map<string, Report>;
  /** The CLI command that produced each cached report. */
  runs: Map<string, string>;
  /** In-progress form values per tool, so switching tools is not destructive. */
  drafts: Map<string, RawValues>;
  error: string | null;
  /** Per-field validation messages for the selected tool. */
  errors: Record<string, string>;
  running: boolean;
  dryRun: boolean;
  theme: Theme;
  density: Density;
  /** Compose the parameters, or read the report. The form survives the trip. */
  view: View;
  reportTab: ReportTab;
  /** Severity the findings list is narrowed to; null shows all of them. */
  findingFilter: Severity | null;
  /** Column sort for the report's data table. */
  reportSort: Sort | null;
  /** Tools this person pinned, in the order they pinned them. */
  pins: string[];
  /** Recently run tools, most recent first. Not the audit trail: this is the UI's memory. */
  recents: string[];
  sheet: Sheet;
  palette: PaletteState;
  history: AuditEntry[];
  /** Where the trail is written, as the runtime reported it. */
  auditPath: string | null;
  historyEnabled: boolean;
  historyLoaded: boolean;
}

/**
 * Preferences, from this version or the last one.
 *
 * Parsing and migration live in `preferences.ts` so a new format version is a
 * tested function rather than a branch inside a module's import.
 */
const saved: Preferences = typeof window === 'undefined' ? {} : readPreferences(window.localStorage);

export const state: AppState = {
  tools: [],
  health: null,
  doctor: null,
  selectedId: saved.selectedId ?? null,
  category: saved.category ?? null,
  reports: new Map(),
  previous: new Map(),
  runs: new Map(),
  drafts: new Map(),
  error: null,
  errors: {},
  running: false,
  dryRun: saved.dryRun ?? false,
  theme: saved.theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  density: saved.density === 'compact' ? 'compact' : 'comfortable',
  view: 'compose',
  reportTab: 'findings',
  findingFilter: null,
  reportSort: null,
  pins: saved.pins ?? [],
  recents: saved.recents ?? [],
  sheet: null,
  palette: { open: false, query: '', index: 0 },
  history: [],
  auditPath: null,
  historyEnabled: true,
  historyLoaded: false,
};

export function persist(): void {
  const snapshot: Preferences = {
    theme: state.theme,
    dryRun: state.dryRun,
    selectedId: state.selectedId,
    category: state.category,
    density: state.density,
    pins: state.pins,
    recents: state.recents,
  };
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(snapshot));
  } catch {
    // Private browsing or a full quota: preferences are best-effort.
  }
}

export function selectedTool(): ToolManifest | null {
  return state.tools.find((tool) => tool.id === state.selectedId) ?? null;
}

/** Categories present in a catalogue, with the number of tools in each. */
export function categories(tools: ToolManifest[] = state.tools): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Most recent first, capped: a workbench remembers habits, not history. */
const RECENTS_LIMIT = 6;

export function touchRecent(toolId: string): void {
  state.recents = [toolId, ...state.recents.filter((id) => id !== toolId)].slice(0, RECENTS_LIMIT);
}

export function togglePin(toolId: string): boolean {
  if (state.pins.includes(toolId)) {
    state.pins = state.pins.filter((id) => id !== toolId);
    return false;
  }
  state.pins = [...state.pins, toolId];
  return true;
}

export function isPinned(toolId: string): boolean {
  return state.pins.includes(toolId);
}

/**
 * The most recent run of each tool, from the audit tail.
 *
 * The trail holds names and outcomes, not values, so this is the only thing the
 * catalogue can say about a tool without pretending to remember more.
 */
export interface RunSummary {
  ts: string;
  status: Status;
  runs: number;
}

/** The newest run of each tool in the tail the window has read. */
export function lastRuns(history: AuditEntry[] = state.history): Map<string, RunSummary> {
  return summariseAudit(history).latest;
}

/** The newest run of one tool, or nothing if it has not run in this tail. */
export function runSummaryFor(toolId: string | null, history: AuditEntry[] = state.history): RunSummary | null {
  return toolId === null ? null : lastRuns(history).get(toolId) ?? null;
}

/** Remember a finished report under its tool and clear any stale error. */
export function rememberReport(toolId: string, report: Report, command?: string): void {
  const before = state.reports.get(toolId);
  if (before) state.previous.set(toolId, before);
  state.reports.set(toolId, report);
  if (command) state.runs.set(toolId, command);
  state.error = null;
}

export function reportFor(toolId: string | null): Report | null {
  return toolId ? state.reports.get(toolId) ?? null : null;
}

export function previousReportFor(toolId: string | null): Report | null {
  return toolId ? state.previous.get(toolId) ?? null : null;
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
  state.previous.delete(toolId);
  state.runs.delete(toolId);
  state.drafts.delete(toolId);
  state.recents = state.recents.filter((id) => id !== toolId);
}
