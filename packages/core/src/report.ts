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
export type OutputFormat = 'text' | 'json' | 'markdown' | 'csv' | 'html';

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
    case 'html':
    case 'htm':
      return 'html';
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
    case 'html':
      return renderHtml(report);
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

/**
 * A report as one self-contained page.
 *
 * This is the web surface: no server, no port, no token, and no request the
 * page can make — the document is complete when it is written. The policy is
 * `default-src 'none'`, so a report that quotes a hostile string stays inert,
 * and every interpolated value is escaped because `target` and `message` come
 * from files the operator did not write.
 */
function renderHtml(report: Report): string {
  const findings = report.findings ?? [];
  const warnings = report.warnings ?? [];

  const head = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`,
    `<title>${escapeHtml(report.tool)} — Gimlet Eye</title>`,
    `<style>${HTML_STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
  ];

  const body = [
    '<header>',
    `<h1>${escapeHtml(report.tool)}</h1>`,
    `<p class="verdict"><span class="status ${escapeHtml(report.status)}">${escapeHtml(report.status)}</span>` +
      `<span class="muted">${report.duration_ms} ms</span></p>`,
    '</header>',
  ];

  if (report.summary) body.push(`<p class="summary">${escapeHtml(report.summary)}</p>`);

  if (findings.length > 0) {
    body.push('<section>', `<h2>Findings <span class="muted">${findings.length}</span></h2>`, '<table>');
    body.push('<thead><tr><th>Severity</th><th>Code</th><th>Message</th><th>Target</th></tr></thead>', '<tbody>');
    for (const finding of findings) {
      body.push(
        `<tr class="sev-${escapeHtml(finding.severity)}">` +
          `<td>${escapeHtml(finding.severity)}</td>` +
          `<td><code>${escapeHtml(finding.code)}</code></td>` +
          `<td>${escapeHtml(finding.message)}</td>` +
          `<td>${escapeHtml(finding.target ?? '')}</td>` +
          '</tr>',
      );
    }
    body.push('</tbody>', '</table>', '</section>');
  }

  if (report.body !== undefined && report.body !== '') {
    body.push('<section>', '<h2>Output</h2>', `<pre>${escapeHtml(report.body.trimEnd())}</pre>`, '</section>');
  } else if (report.data !== undefined && report.data !== null) {
    const json = JSON.stringify(report.data, null, 2) ?? '';
    body.push('<section>', '<h2>Data</h2>', `<pre>${escapeHtml(json)}</pre>`, '</section>');
  }

  if (warnings.length > 0) {
    body.push('<section>', '<h2>Warnings</h2>', '<ul class="warnings">');
    for (const warning of warnings) body.push(`<li>${escapeHtml(warning)}</li>`);
    body.push('</ul>', '</section>');
  }

  const foot = [
    '</main>',
    '<footer>Generated by Gimlet Eye. Self-contained: no script, no network, no tracking.</footer>',
    '</body>',
    '</html>',
  ];

  return `${[...head, ...body, ...foot].join('\n')}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const HTML_STYLE = `
:root { color-scheme: dark; }
body { margin: 0; padding: 2rem 1.25rem; background: #14110e; color: #e8ddc8;
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 60rem; margin: 0 auto; }
h1 { margin: 0 0 .35rem; font-size: 1.45rem; letter-spacing: .01em; }
h2 { font-size: 1.02rem; margin: 1.8rem 0 .6rem; color: #c9a227; }
.verdict { display: flex; gap: .6rem; align-items: center; margin: 0; }
.status { padding: .1rem .55rem; border-radius: 999px; font-size: .8rem; text-transform: uppercase;
  letter-spacing: .06em; border: 1px solid currentColor; }
.status.ok { color: #7ec699; } .status.warning { color: #e0b34a; } .status.error { color: #e06c6c; }
.muted { color: #8a8172; font-size: .85rem; }
.summary { margin: .9rem 0 0; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .42rem .6rem; border-bottom: 1px solid #2a251f; vertical-align: top; }
th { color: #8a8172; font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; }
tr.sev-high td:first-child, tr.sev-critical td:first-child { color: #e06c6c; }
tr.sev-medium td:first-child { color: #e0b34a; }
tr.sev-low td:first-child { color: #7ec699; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
pre { background: #1b1713; border: 1px solid #2a251f; border-radius: 6px; padding: .85rem;
  overflow-x: auto; font-size: .86rem; }
.warnings { margin: 0; padding-left: 1.2rem; color: #c9b48a; }
footer { max-width: 60rem; margin: 2.5rem auto 0; color: #776d5f; font-size: .78rem;
  border-top: 1px solid #2a251f; padding-top: .8rem; }
`;
