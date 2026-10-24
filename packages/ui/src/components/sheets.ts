import { escapeHtml, formatWhen, humanDuration } from '../lib/format';
import type { AppState } from '../lib/store';
import { icons } from './icons';

function statusDot(status: string): string {
  const tone = status === 'ok' ? 'ok' : status === 'warning' ? 'warn' : 'error';
  return `<span class="dot dot--${tone}"></span>`;
}

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

function packsBody(state: AppState): string {
  if (state.packs.length === 0) {
    return `
      <p class="muted">No packs are loaded. Every tool listed is native.</p>
      <p class="muted">Packs add capabilities written in any language:
        <code>scripts/link-sources.sh</code> fetches the compatibility sources,
        then <code>mellivora plugins doctor</code> reports what loaded.</p>`;
  }

  return `
    <ul class="pack-list">
      ${state.packs
        .map(
          (pack) => `
        <li class="pack">
          <div class="pack-head">
            <strong>${escapeHtml(pack.name)}</strong>
            <span class="muted">v${escapeHtml(pack.version)}</span>
            <span class="chip chip--quiet">${pack.tool_count} tool${pack.tool_count === 1 ? '' : 's'}</span>
          </div>
          ${pack.description ? `<p class="pack-summary">${escapeHtml(pack.description)}</p>` : ''}
          ${(pack.capabilities ?? []).length > 0
            ? `<div class="pack-caps">${pack.capabilities
                .map((capability) => `<span class="chip">${escapeHtml(capability)}</span>`)
                .join('')}</div>`
            : ''}
          <code class="pack-dir">${escapeHtml(pack.dir)}</code>
        </li>`,
        )
        .join('')}
    </ul>`;
}

function historyBody(state: AppState): string {
  if (!state.historyEnabled) {
    return `<p class="muted">The audit trail is disabled in the configuration.
      Enable <code>[audit] enabled = true</code> to keep a local record of runs.</p>`;
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
          <span title="${escapeHtml(entry.status)}">${statusDot(entry.status)}</span>
          <button class="run-tool" data-tool="${escapeHtml(entry.tool)}" data-sheet-close
                  title="Open ${escapeHtml(entry.tool)}">${escapeHtml(entry.tool)}</button>
          <span class="run-meta muted">${escapeHtml(formatWhen(entry.ts))}</span>
          <span class="run-meta muted">${humanDuration(entry.duration_ms)}</span>
          ${(entry.arg_keys ?? []).length > 0
            ? `<span class="run-args">${entry.arg_keys!
                .map((key) => `<code>${escapeHtml(key)}</code>`)
                .join('')}</span>`
            : ''}
        </li>`,
        )
        .join('')}
    </ul>`;
}

export function renderSheets(state: AppState): string {
  if (state.sheet === 'packs') return shell('Loaded packs', packsBody(state), 'packs');
  if (state.sheet === 'history') return shell('Recent runs', historyBody(state), 'history');
  return '';
}
