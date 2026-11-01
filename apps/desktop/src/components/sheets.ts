import { escapeHtml, formatWhen, humanDuration, modLabel } from '../lib/format';
import { shortcuts } from '../lib/shortcuts';
import type { AppState } from '../lib/store';
import { icons } from './icons';
import { statusBadge } from './status';

function shell(title: string, body: string, kind: string): string {
  return `
    <div class="sheet-backdrop" data-sheet-backdrop data-sheet-${kind}>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" data-sheet-panel>
        <header class="sheet-head">
          <h2>${escapeHtml(title)}</h2>
          <button class="icon-button" data-sheet-close aria-label="Close">${icons.close}</button>
        </header>
        <div class="sheet-body">${body}</div>
      </section>
    </div>`;
}

function historyBody(state: AppState): string {
  if (!state.historyEnabled) {
    return `<p class="muted">The audit trail is disabled in the configuration.
      Enable <code>[audit] enabled = true</code> to keep a local record of runs${
        state.auditPath ? `, at <code>${escapeHtml(state.auditPath)}</code>` : ''
      }.</p>`;
  }
  if (!state.historyLoaded) {
    return `<p class="muted">Loading…</p>`;
  }
  if (state.history.length === 0) {
    return `<p class="muted">No runs recorded yet. Every run is logged locally with the
      argument <em>names</em> only — never their values.</p>`;
  }

  return `
    <ul class="run-list">
      ${state.history
        .map(
          (entry) => `
        <li class="run">
          ${statusBadge(entry.status)}
          <button class="run-tool" data-tool="${escapeHtml(entry.tool)}" data-sheet-close
                  title="Open ${escapeHtml(entry.tool)}">${escapeHtml(entry.tool)}</button>
          <span class="run-meta muted" data-volatile>${escapeHtml(formatWhen(entry.ts))}</span>
          <span class="run-meta muted" data-volatile>${humanDuration(entry.duration_ms)}</span>
          ${(entry.arg_keys ?? []).length > 0
            ? `<span class="run-args">${entry.arg_keys!
                .map((key) => `<code>${escapeHtml(key)}</code>`)
                .join('')}</span>`
            : ''}
        </li>`,
        )
        .join('')}
    </ul>
    ${state.auditPath ? `<p class="sheet-note">Trail: <code>${escapeHtml(state.auditPath)}</code></p>` : ''}`;
}

function row(label: string, value: string, copy?: string): string {
  return `
    <div class="kv-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>
        <code class="kv-value" title="${escapeHtml(value)}">${escapeHtml(value)}</code>
        ${copy === undefined ? '' : `<button class="icon-button icon-button--tiny" data-copy="${escapeHtml(copy)}"
            title="Copy" aria-label="Copy ${escapeHtml(label)}">${icons.copy}</button>`}
      </dd>
    </div>`;
}

function diagnosticsBody(state: AppState): string {
  // The live reading when the sheet has one, the boot snapshot otherwise.
  const health = state.doctor ?? state.health;
  const density = state.density === 'compact' ? 'compact' : 'comfortable';

  const identity = `
    <section class="sheet-section">
      <h3>This build</h3>
      <dl class="kv-list">
        ${row('Version', health ? health.version : 'unavailable', health?.version)}
        ${row('Engine', health ? (health.engine === 'none' ? 'built in' : health.engine) : 'unavailable')}
        ${row('Tools', health ? String(health.tools) : 'unknown')}
      </dl>
    </section>`;

  const paths = health
    ? `
    <section class="sheet-section">
      <h3>Where data lives</h3>
      <dl class="kv-list">
        ${row('Home', health.home, health.home)}
        ${row('Configuration', health.config, health.config)}
        ${row('Audit trail', health.audit, health.audit)}
      </dl>
      <div class="sheet-actions">
        <button class="button" data-reveal="${escapeHtml(health.home)}">${icons.folder}Open data folder</button>
      </div>
      <p class="sheet-note">Nothing here leaves this machine. The app makes no network requests.</p>
    </section>`
    : `<p class="muted">The runtime has not answered yet, so the paths are unknown.</p>`;

  const preferences = `
    <section class="sheet-section">
      <h3>Preferences</h3>
      <dl class="kv-list">
        ${row('Theme', state.theme)}
        ${row('Density', density)}
        ${row('Dry run', state.dryRun ? 'on' : 'off')}
        ${state.doctor === null ? '' : row('Audit', state.doctor.auditEnabled ? 'recording' : 'disabled')}
      </dl>
      <div class="sheet-actions">
        <button class="button" data-action="theme">Switch theme</button>
        <button class="button" data-action="density">Use ${density === 'compact' ? 'comfortable' : 'compact'} spacing</button>
        <button class="button" data-action="shortcuts">${icons.terminal}Shortcuts</button>
      </div>
    </section>`;

  return identity + paths + preferences;
}

function shortcutsBody(): string {
  return `
    <dl class="shortcut-list">
      ${shortcuts(modLabel)
        .map(
          (entry) => `<div class="shortcut-row">
            <dt>${entry.keys
              .split(' ')
              .map((key) => `<kbd>${escapeHtml(key)}</kbd>`)
              .join('')}</dt>
            <dd>${escapeHtml(entry.label)}</dd>
          </div>`,
        )
        .join('')}
    </dl>`;
}

export function renderSheets(state: AppState): string {
  switch (state.sheet) {
    case 'history':
      return shell('Recent runs', historyBody(state), 'history');
    case 'diagnostics':
      return shell('Settings and diagnostics', diagnosticsBody(state), 'diagnostics');
    case 'shortcuts':
      return shell('Keyboard shortcuts', shortcutsBody(), 'shortcuts');
    default:
      return '';
  }
}
