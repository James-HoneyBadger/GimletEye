import { diffData } from '../lib/diff';
import { groupFindings, severityOrder, suggestionFor } from '../lib/findings';
import { escapeHtml, formatBytes, formatPercent, humanDuration, plural, titleCase } from '../lib/format';
import { findingsMarkdown } from '../lib/markdown';
import { renderData } from '../lib/data';
import { reportView, type ReportSection } from '../lib/report-view';
import type { AppState } from '../lib/store';
import type { Finding, Report } from '../lib/engine';
import { icons } from './icons';
import { statusBadge } from './status';

interface ByteSegment {
  label: string;
  kind: string;
  category: string;
  offset: number;
  size: number;
}

function isSegment(value: unknown): value is ByteSegment {
  if (typeof value !== 'object' || value === null) return false;
  const segment = value as Record<string, unknown>;
  return (
    typeof segment['offset'] === 'number' &&
    typeof segment['size'] === 'number' &&
    typeof segment['label'] === 'string' &&
    typeof segment['category'] === 'string'
  );
}

const REMOVABLE = new Set(['identity', 'text', 'time']);

/**
 * Where the metadata sits in the file.
 *
 * The scan already reports `segments` with offsets; drawing them is the one view
 * that makes "this photo carries 1.2 kB of identity" land as a fact rather than a
 * number.
 */
function byteMap(report: Report): string {
  const data = report.data;
  if (typeof data !== 'object' || data === null) return '';
  const value = data as Record<string, unknown>;
  const raw = value['segments'];
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const total = typeof value['size_bytes'] === 'number' ? value['size_bytes'] : 0;
  if (total <= 0) return '';

  const segments = raw.filter(isSegment).slice(0, 400);
  const removed =
    typeof value['removable_bytes'] === 'number'
      ? value['removable_bytes']
      : segments.filter((segment) => REMOVABLE.has(segment.category)).reduce((sum, segment) => sum + segment.size, 0);

  const bars = segments
    .map((segment) => {
      const left = Math.min(100, Math.max(0, (segment.offset / total) * 100));
      const width = Math.min(100 - left, Math.max(0.15, (segment.size / total) * 100));
      const tone = REMOVABLE.has(segment.category) ? 'removable' : 'kept';
      const label = `${segment.label} · ${segment.kind} · ${formatBytes(segment.size)}`;
      return `<span class="byte-seg byte-seg--${tone}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${escapeHtml(label)}"></span>`;
    })
    .join('');

  const note = `${formatBytes(removed)} of ${formatBytes(total)} removable (${formatPercent(
    removed / total,
  )}) across ${plural(segments.length, 'segment')}`;

  return `
    <section class="byte-map" aria-label="Where the metadata is">
      <div class="byte-map-bar" role="img" aria-label="${escapeHtml(note)}">${bars}</div>
      <p class="byte-map-note muted">${escapeHtml(note)}</p>
    </section>`;
}

/**
 * A failed run, with the two things a person wants next: the same run again,
 * and the message in a form they can paste somewhere.
 */
export function failureCallout(message: string): string {
  return `
    <div class="callout callout--error" role="alert">
      <strong>${icons.error}Request failed</strong>
      <p>${escapeHtml(message)}</p>
      <div class="callout-actions">
        <button class="button" data-retry-run>${icons.refresh}Try again</button>
        <button class="icon-button icon-button--tiny" data-copy="${escapeHtml(message)}"
                title="Copy the error" aria-label="Copy the error">${icons.copy}</button>
      </div>
    </div>`;
}

function suggestionButton(label: string, tool: string, args: Record<string, string>, icon: string): string {
  return `<button class="button button--quiet" data-suggest-tool="${escapeHtml(tool)}"
      data-suggest-args="${escapeHtml(JSON.stringify(args))}">${icon}${escapeHtml(label)}</button>`;
}

function filterChips(report: Report, state: AppState, shown: Finding[]): string {
  const items = report.findings ?? [];
  const counts = new Map<string, number>();
  for (const finding of items) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  const severities = [...counts.keys()].sort((a, b) => severityOrder(a) - severityOrder(b));
  const filter = state.findingFilter;

  return `
    <div class="finding-filters" role="group" aria-label="Filter findings by severity">
      <button class="filter-chip${filter === null ? ' is-active' : ''}" data-finding-filter=""
              aria-pressed="${filter === null}">All <span class="count">${items.length}</span></button>
      ${severities
        .map(
          (severity) => `
        <button class="filter-chip filter-chip--${escapeHtml(severity)}${filter === severity ? ' is-active' : ''}"
                data-finding-filter="${escapeHtml(severity)}" aria-pressed="${filter === severity}">
          ${escapeHtml(titleCase(severity))} <span class="count">${counts.get(severity) ?? 0}</span>
        </button>`,
        )
        .join('')}
      <button class="icon-button icon-button--tiny" data-copy="${escapeHtml(findingsMarkdown(report, shown))}"
              title="Copy ${state.findingFilter === null ? 'the findings' : 'the filtered findings'} as Markdown"
              aria-label="Copy findings as Markdown">${icons.copy}</button>
    </div>`;
}

function findingsBody(report: Report, state: AppState): string {
  const items = report.findings ?? [];
  if (items.length === 0) {
    return `<div class="report-empty">
      <p class="muted">No findings. Nothing here needs a decision.</p>
    </div>`;
  }

  const shown = state.findingFilter === null ? items : items.filter((finding) => finding.severity === state.findingFilter);

  return `${filterChips(report, state, shown)}${groupFindings(shown)
    .map(
      (group) => `
    <section class="finding-group">
      <h3 class="finding-group-title">${escapeHtml(titleCase(group.severity))}<span class="count">${group.findings.length}</span></h3>
      <ul class="findings">
        ${group.findings
          .map((finding) => {
            const suggestion = suggestionFor(
              finding.code,
              report.data,
              (tool) => state.tools.some((entry) => entry.id === tool),
            );
            return `
          <li class="finding finding--${escapeHtml(finding.severity)}">
            <span class="severity">${escapeHtml(finding.severity)}</span>
            <div class="finding-body">
              <code class="finding-code">${escapeHtml(finding.code)}</code>
              <span class="finding-message">${escapeHtml(finding.message)}</span>
              ${finding.target ? `<span class="finding-target">${escapeHtml(finding.target)}</span>` : ''}
            </div>
            ${
              suggestion
                ? suggestionButton(suggestion.label, suggestion.tool, suggestion.args, icons.play)
                : ''
            }
          </li>`;
          })
          .join('')}
      </ul>
    </section>`,
    )
    .join('')}`;
}

function dataBody(report: Report, state: AppState): string {
  const tool = state.tools.find((entry) => entry.id === state.selectedId) ?? null;
  return `<section class="result-section">${renderData(report.data, tool?.data, state.reportSort ?? undefined)}</section>`;
}

function changesBody(report: Report, previous: Report): string {
  const { changes, truncated } = diffData(previous.data, report.data);
  if (changes.length === 0) {
    return `<div class="report-empty"><p class="muted">Nothing changed since the previous run of this tool.</p></div>`;
  }
  return `
    <ul class="change-list">
      ${changes
        .map(
          (change) => `
        <li class="change change--${change.kind}">
          <span class="change-kind">${change.kind}</span>
          <code class="change-key">${escapeHtml(change.key)}</code>
          ${
            change.kind === 'changed'
              ? `<span class="change-fields">${change.fields
                  .map((field) => `<code>${escapeHtml(field)}</code>`)
                  .join('')}</span>`
              : ''
          }
        </li>`,
        )
        .join('')}
    </ul>
    ${truncated ? `<p class="sheet-note">Showing the first 200 changes.</p>` : ''}`;
}

function tabs(sections: ReportSection[], state: AppState): string {
  const icon: Record<string, string> = {
    findings: icons.warning,
    data: icons.table,
    changes: icons.diff,
    raw: icons.braces,
  };
  return `<nav class="report-tabs" role="tablist" aria-label="Report sections">
    ${sections
      .map(
        (section) => `
      <button role="tab" data-report-tab="${section.id}" aria-selected="${state.reportTab === section.id}"
              class="report-tab${state.reportTab === section.id ? ' is-active' : ''}"
              id="report-tab-${section.id}" aria-controls="report-panel">
        ${icon[section.id] ?? ''}${section.label}${section.count === undefined ? '' : ` <span class="count">${section.count}</span>`}
      </button>`,
      )
      .join('')}
  </nav>`;
}

function wasDryRun(report: Report): boolean {
  const data = report.data;
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>).dry_run === true;
}

export function renderReport(state: AppState): string {
  const view = reportView(state);
  const { tool, report, previous, verifier, sections } = view;

  if (state.running) {
    return `
      <main class="main main--report" id="main" tabindex="-1">
        <section class="report">
          <div class="panel result" aria-busy="true">
            <div class="skeleton-row"></div>
            <div class="skeleton-row skeleton-row--short"></div>
            <div class="skeleton-block"></div>
          </div>
          <p class="muted report-running">Running ${escapeHtml(tool?.title ?? 'the tool')}…</p>
        </section>
      </main>`;
  }

  const failure = state.error === null ? '' : failureCallout(state.error);

  if (!report) {
    return `
      <main class="main main--report" id="main" tabindex="-1">
        <section class="report">
          ${failure || `<div class="callout callout--info"><strong>${icons.arrowLeft}Nothing to show yet</strong>
            <p>Run the tool, and its report appears here.</p></div>`}
          <div class="report-actions">
            <button class="button button--primary" data-edit-parameters>${icons.arrowLeft}Edit parameters</button>
          </div>
        </section>
      </main>`;
  }

  const json = JSON.stringify(report, null, 2);
  const command = state.runs.get(report.tool) ?? `gimlet run ${report.tool}`;

  let body: string;
  switch (state.reportTab) {
    case 'data':
      body = dataBody(report, state);
      break;
    case 'changes':
      body = previous ? changesBody(report, previous) : dataBody(report, state);
      break;
    case 'raw':
      body = `<pre class="code-block code-block--report">${escapeHtml(json)}</pre>`;
      break;
    default:
      body = findingsBody(report, state);
  }

  return `
    <main class="main main--report" id="main" tabindex="-1">
      <section class="report">
        <header class="report-head">
          <div class="report-crumbs">
            <button class="link-button" data-edit-parameters>${icons.arrowLeft}Back</button>
            <code class="muted">${escapeHtml(report.tool)}</code>
          </div>
          <div class="report-title">
            <h1 tabindex="-1">${escapeHtml(tool?.title ?? report.tool)}</h1>
            <span class="muted report-duration" data-volatile>${humanDuration(report.duration_ms)}</span>
          </div>
          <div class="report-verdict">
            ${statusBadge(report.status)}
            <p>${escapeHtml(report.summary)}</p>
          </div>
          <div class="report-actions">
            <button class="button button--primary" data-edit-parameters>Edit parameters</button>
            <button class="button" data-retry-run>${icons.refresh}Run again</button>
            ${
              verifier
                ? suggestionButton(verifier.label, verifier.tool, verifier.args, icons.shield)
                : ''
            }
            <button class="icon-button icon-button--tiny" data-copy="${escapeHtml(command)}"
                    title="Copy the equivalent CLI command: ${escapeHtml(command)}" aria-label="Copy CLI command">
              ${icons.terminal}
            </button>
            <button class="icon-button icon-button--tiny" data-copy="${escapeHtml(json)}"
                    title="Copy report as JSON" aria-label="Copy report as JSON">${icons.copy}</button>
            <button class="icon-button icon-button--tiny" data-download="${escapeHtml(report.tool)}"
                    title="Download report as JSON" aria-label="Download report as JSON">${icons.download}</button>
          </div>
        </header>

        ${failure}
        ${byteMap(report)}
        ${
          wasDryRun(report)
            ? `<div class="callout callout--info"><strong>${icons.shield}Dry run</strong>
                 <p>Nothing was written. Run again with dry run off to apply these changes.</p></div>`
            : ''
        }
        ${tabs(sections, state)}

        <div id="report-panel" role="tabpanel" aria-labelledby="report-tab-${state.reportTab}">
          ${body}
        </div>
      </section>
    </main>`;
}
