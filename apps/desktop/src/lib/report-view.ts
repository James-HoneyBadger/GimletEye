import type { Report, ToolManifest } from './engine';
import type { AppState, ReportTab } from './store';

export interface Verifier {
  label: string;
  tool: string;
  args: Record<string, string>;
}

export interface ReportSection {
  id: ReportTab;
  label: string;
  count?: number;
}

/** Tools whose output a second tool can check, and where the value to check is. */
const VERIFIERS: Record<string, { label: string; tool: string; from: string[]; argument: string }> = {
  'privacy.metadata-strip': {
    label: 'Verify removal',
    tool: 'privacy.metadata-verify',
    from: ['path', 'output', 'input'],
    argument: 'input',
  },
  'crypto.encrypt': {
    label: 'Inspect the container',
    tool: 'crypto.inspect',
    from: ['path', 'output'],
    argument: 'input',
  },
};

function pathFrom(report: Report, keys: string[]): string | null {
  const data = typeof report.data === 'object' && report.data !== null ? (report.data as Record<string, unknown>) : {};
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

export interface ReportView {
  tool: ToolManifest | null;
  report: Report | null;
  previous: Report | null;
  verifier: Verifier | null;
  sections: ReportSection[];
}

/**
 * Everything the report pane needs, from the state it was given.
 *
 * Components used to take a `state` parameter and then call `reportFor()` and
 * `selectedTool()`, which read the module singleton — right in production, a trap
 * everywhere else.
 */
export function reportView(state: AppState): ReportView {
  const tool = state.tools.find((entry) => entry.id === state.selectedId) ?? null;
  const report = state.selectedId === null ? null : state.reports.get(state.selectedId) ?? null;
  const previous = state.selectedId === null ? null : state.previous.get(state.selectedId) ?? null;

  const sections: ReportSection[] = [
    { id: 'findings', label: 'Findings', count: report?.findings?.length ?? 0 },
    { id: 'data', label: 'Data' },
  ];
  if (previous) sections.push({ id: 'changes', label: 'Changes' });
  sections.push({ id: 'raw', label: 'Raw' });

  let verifier: Verifier | null = null;
  if (report) {
    const rule = VERIFIERS[report.tool];
    const path = rule ? pathFrom(report, rule.from) : null;
    if (rule && path !== null) verifier = { label: rule.label, tool: rule.tool, args: { [rule.argument]: path } };
  }

  return { tool, report, previous, verifier, sections };
}
