import { escapeHtml, humanDuration } from '../lib/format';
import type { AppState } from '../lib/store';
import { renderData } from '../lib/data';
import { icons } from './icons';

function statusBadge(status: string): string {
  const icon = status === 'ok' ? icons.check : status === 'warning' ? icons.warning : icons.error;
  return `<span class="status status--${escapeHtml(status)}">${icon}${escapeHtml(status)}</span>`;
}

function findings(report: NonNullable<AppState['report']>): string {
  const items = report.findings ?? [];
  if (items.length === 0) return '';
  return `
    <section class="result-section">
      <h3>Findings <span class="count">${items.length}</span></h3>
      <ul class="findings">
        ${items
          .map(
            (finding) => `
          <li class="finding finding--${escapeHtml(finding.severity)}">
            <span class="severity">${escapeHtml(finding.severity)}</span>
            <div class="finding-body">
              <code class="finding-code">${escapeHtml(finding.code)}</code>
              <span class="finding-message">${escapeHtml(finding.message)}</span>
              ${finding.target ? `<span class="finding-target">${escapeHtml(finding.target)}</span>` : ''}
            </div>
          </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

function warnings(report: NonNullable<AppState['report']>): string {
  const items = report.warnings ?? [];
  if (items.length === 0) return '';
  return `
    <section class="callout callout--warning">
      <strong>${icons.warning}Warnings</strong>
      <ul>${items.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
    </section>`;
}

export function renderResult(state: AppState): string {
  if (state.error) {
    return `
      <section class="panel result">
        <div class="callout callout--error">
          <strong>${icons.error}Request failed</strong>
          <p>${escapeHtml(state.error)}</p>
        </div>
      </section>`;
  }

  if (state.running && !state.report) {
    return `
      <section class="panel result" aria-busy="true">
        <div class="skeleton-row"></div>
        <div class="skeleton-row skeleton-row--short"></div>
        <div class="skeleton-block"></div>
      </section>`;
  }

  const report = state.report;
  if (!report) {
    return `
      <section class="panel result result--idle">
        <p class="muted">Run the tool to see its report here. Nothing leaves this machine.</p>
      </section>`;
  }

  const json = JSON.stringify(report, null, 2);

  const details = `
    ${findings(report)}
    ${warnings(report)}
    ${
      report.body
        ? `<section class="result-section"><h3>Report</h3><pre class="code-block report-body">${escapeHtml(report.body)}</pre></section>`
        : ''
    }
    <section class="result-section">
      <h3>Data</h3>
      ${renderData(report.data)}
    </section>`;

  return `
    <section class="panel result">
      <header class="result-head">
        <div class="result-headline">
          ${statusBadge(report.status)}
          <span class="result-summary">${escapeHtml(report.summary)}</span>
        </div>
        <div class="result-tools">
          <span class="muted">${humanDuration(report.duration_ms)}</span>
          <div class="segmented" role="tablist" aria-label="Result view">
            <button role="tab" data-tab="details" class="${state.tab === 'details' ? 'is-active' : ''}" aria-selected="${state.tab === 'details'}">Details</button>
            <button role="tab" data-tab="json" class="${state.tab === 'json' ? 'is-active' : ''}" aria-selected="${state.tab === 'json'}">JSON</button>
          </div>
          <button class="icon-button icon-button--tiny" data-copy="${escapeHtml(json)}" title="Copy report as JSON" aria-label="Copy report as JSON">
            ${icons.copy}
          </button>
        </div>
      </header>
      ${
        state.tab === 'json'
          ? `<pre class="code-block code-block--report">${escapeHtml(json)}</pre>`
          : details
      }
    </section>`;
}
