/**
 * The normalized result of every tool run.
 *
 * One shape for system checks, crypto operations, and metadata scrubbing is
 * what lets the CLI and the desktop render anything without a special case per
 * tool. It is also the sidecar's response body, so the renderers here are the
 * only place that knows how a report turns into text.
 */

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type Status = 'ok' | 'warning' | 'error';
export type OutputFormat = 'text' | 'json' | 'markdown' | 'csv';

const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const SEVERITY_SYMBOL: Record<Severity, string> = {
  info: 'i',
  low: '-',
  medium: '!',
  high: '▲',
  critical: '✖',
};

export const STATUS_SYMBOL: Record<Status, string> = {
  ok: '✔',
  warning: '!',
  error: '✖',
};

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
  target?: string;
}

export interface Report {
  tool: string;
  status: Status;
  summary: string;
  findings?: Finding[];
  data?: unknown;
  /** A body the tool formatted itself; text and markdown prefer it over `data`. */
  body?: string;
  warnings?: string[];
  duration_ms: number;
}

export function parseOutputFormat(value: string): OutputFormat {
  switch (value.trim().toLowerCase()) {
    case 'text':
    case 'plain':
      return 'text';
    case 'json':
      return 'json';
    case 'markdown':
    case 'md':
      return 'markdown';
    case 'csv':
      return 'csv';
    default:
      throw new Error(`unknown output format '${value}'`);
  }
}

/**
 * Derive the verdict from the findings.
 *
 * Tools call this last, so a single high finding can never be reported as ok.
 */
export function sealed(report: Report): Report {
  const findings = report.findings ?? [];
  const worst = findings.reduce((max, finding) => Math.max(max, SEVERITY_ORDER[finding.severity]), 0);
  const status: Status = worst >= SEVERITY_ORDER.high ? 'error' : worst >= SEVERITY_ORDER.medium ? 'warning' : 'ok';
  return { ...report, status };
}

export function render(report: Report, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(report, null, 2);
    case 'markdown':
      return renderMarkdown(report);
    case 'csv':
      return renderCsv(report);
    case 'text':
      return renderText(report);
  }
}

function renderText(report: Report): string {
  const lines: string[] = [`${STATUS_SYMBOL[report.status]} ${report.tool}  (${report.duration_ms} ms)`];
  if (report.summary) lines.push(`  ${report.summary}`);

  const findings = report.findings ?? [];
  if (findings.length > 0) {
    lines.push('', 'Findings');
    for (const finding of findings) {
      const target = finding.target ? `  (${finding.target})` : '';
      lines.push(
        `  ${SEVERITY_SYMBOL[finding.severity]} [${finding.severity.padEnd(8)}] ${finding.code}: ${finding.message}${target}`,
      );
    }
  }

  if (report.body) {
    lines.push('', report.body.trimEnd());
  } else if (report.data !== undefined && report.data !== null) {
    lines.push('', 'Data');
    for (const line of JSON.stringify(report.data, null, 2).split('\n')) lines.push(`  ${line}`);
  }

  const warnings = report.warnings ?? [];
  if (warnings.length > 0) {
    lines.push('', 'Warnings');
    for (const warning of warnings) lines.push(`  - ${warning}`);
  }

  return `${lines.join('\n')}\n`;
}

function renderMarkdown(report: Report): string {
  const out: string[] = [`## ${report.tool}\n`, `**Status:** ${report.status} · **Duration:** ${report.duration_ms} ms\n`];
  if (report.summary) out.push(`${report.summary}\n`);

  const findings = report.findings ?? [];
  if (findings.length > 0) {
    out.push('| Severity | Code | Message | Target |', '|---|---|---|---|');
    for (const finding of findings) {
      out.push(`| ${finding.severity} | \`${finding.code}\` | ${finding.message} | ${finding.target ?? ''} |`);
    }
    out.push('');
  }

  if (report.body) {
    out.push(`${report.body.trimEnd()}\n`);
  } else if (report.data !== undefined && report.data !== null) {
    out.push('```json', JSON.stringify(report.data, null, 2), '```\n');
  }

  const warnings = report.warnings ?? [];
  if (warnings.length > 0) {
    out.push('**Warnings**\n');
    for (const warning of warnings) out.push(`- ${warning}`);
    out.push('');
  }

  return `${out.join('\n')}\n`;
}

function renderCsv(report: Report): string {
  if (Array.isArray(report.data) && report.data.every((item) => isRecord(item))) {
    const columns: string[] = [];
    for (const item of report.data) {
      for (const key of Object.keys(item)) if (!columns.includes(key)) columns.push(key);
    }
    const out = [columns.join(',')];
    for (const item of report.data) {
      out.push(columns.map((column) => csvEscape(item[column])).join(','));
    }
    return `${out.join('\n')}\n`;
  }

  const out = ['key,value'];
  if (isRecord(report.data)) {
    for (const [key, value] of Object.entries(report.data)) out.push(`${csvEscape(key)},${csvEscape(value)}`);
  }
  return `${out.join('\n')}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function csvEscape(value: unknown): string {
  const raw =
    value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}
