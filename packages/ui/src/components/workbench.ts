import type { ArgSpec } from '../lib/api';
import { escapeHtml, isNative, modLabel, originLabel, titleCase } from '../lib/format';
import type { AppState } from '../lib/store';
import { icons } from './icons';
import { renderResult } from './result';

function field(spec: ArgSpec): string {
  const id = `arg-${spec.name}`;
  const label = `<label for="${id}">${escapeHtml(titleCase(spec.name))}${spec.required ? '<span class="required" title="Required">*</span>' : ''}</label>`;
  const help = spec.help ? `<p class="field-help">${escapeHtml(spec.help)}</p>` : '';
  const type = spec.type;
  const raw = spec.default === undefined || spec.default === null ? '' : String(spec.default);

  let control: string;
  if (type === 'boolean') {
    const checked = spec.default === true ? 'checked' : '';
    control = `
      <label class="switch" for="${id}">
        <input type="checkbox" id="${id}" name="${escapeHtml(spec.name)}" data-type="boolean" ${checked} />
        <span class="switch-track"><span class="switch-thumb"></span></span>
        <span class="switch-text">${checked ? 'Enabled' : 'Disabled'}</span>
      </label>`;
  } else if (type === 'enum' && spec.values?.length) {
    control = `<select id="${id}" name="${escapeHtml(spec.name)}" data-type="string">
      ${spec.values
        .map(
          (value) =>
            `<option value="${escapeHtml(value)}"${value === raw ? ' selected' : ''}>${escapeHtml(value)}</option>`,
        )
        .join('')}
    </select>`;
  } else {
    const inputType = type === 'integer' ? 'number' : 'text';
    const placeholder = type === 'path' ? '/path/to/file' : '';
    const mono = type === 'path' ? ' input--mono' : '';
    control = `<input class="input${mono}" type="${inputType}" id="${id}" name="${escapeHtml(spec.name)}"
      data-type="${type}" placeholder="${placeholder}" value="${escapeHtml(raw)}" spellcheck="false" autocomplete="off" />`;
  }

  return `<div class="field field--${type}">${label}${control}${help}</div>`;
}

function emptyState(): string {
  return `
    <section class="empty-state">
      <div class="empty-art" aria-hidden="true">${icons.layers}</div>
      <h1>Pick a tool to begin</h1>
      <p class="muted">Everything runs locally against this machine. Choose a tool on the left,
        or press <kbd>${modLabel} K</kbd> and start typing.</p>
      <div class="empty-hints">
        <div class="hint-card"><strong>System</strong><span>Inventory, disk capacity, host checks</span></div>
        <div class="hint-card"><strong>Crypto</strong><span>Encrypt files, sign and verify, generate secrets</span></div>
        <div class="hint-card"><strong>Privacy</strong><span>Inspect and remove metadata, redact GPS</span></div>
      </div>
    </section>`;
}

export function renderWorkbench(state: AppState): string {
  const tool = state.tools.find((candidate) => candidate.id === state.selectedId);
  if (!tool) {
    return `<main class="main">${emptyState()}</main>`;
  }

  const args = tool.args ?? [];
  const capabilities = (tool.capabilities ?? []).map((capability) => `<span class="chip">${escapeHtml(capability)}</span>`).join('');
  const tags = (tool.tags ?? []).slice(0, 4).map((tag) => `<span class="chip chip--quiet">${escapeHtml(tag)}</span>`).join('');

  return `
    <main class="main">
      <section class="tool-head">
        <div class="tool-head-top">
          <div>
            <h1 class="tool-name">${escapeHtml(tool.title)}</h1>
            <p class="tool-summary">${escapeHtml(tool.summary)}</p>
          </div>
          <span class="badge ${isNative(tool.origin) ? 'badge--native' : 'badge--pack'}">${escapeHtml(originLabel(tool.origin))}</span>
        </div>

        <div class="tool-meta">
          <code class="tool-id">${escapeHtml(tool.id)}</code>
          <button class="icon-button icon-button--tiny" data-copy="${escapeHtml(tool.id)}" title="Copy tool id" aria-label="Copy tool id">
            ${icons.copy}
          </button>
          ${capabilities}
          ${tags}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Parameters</h2>
          <span class="muted">${args.length === 0 ? 'none required' : `${args.length} field${args.length === 1 ? '' : 's'}`}</span>
        </div>
        ${args.length === 0
          ? '<p class="muted panel-body">This tool takes no parameters.</p>'
          : `<form class="args-grid panel-body" id="args" autocomplete="off">${args.map(field).join('')}</form>`}
      </section>

      <section class="actionbar">
        <label class="switch" for="dry-run">
          <input type="checkbox" id="dry-run" ${state.dryRun ? 'checked' : ''} />
          <span class="switch-track"><span class="switch-thumb"></span></span>
          <span class="switch-text">Dry run</span>
        </label>
        <span class="actionbar-spacer"></span>
        <span class="kbd-hint"><kbd>${modLabel}</kbd><kbd>↵</kbd></span>
        <button class="button button--primary" id="run" ${state.running ? 'disabled' : ''}>
          ${state.running ? '<span class="spinner" aria-hidden="true"></span>Running…' : `${icons.play}Run`}
        </button>
      </section>

      <div id="result-region">${renderResult(state)}</div>
    </main>`;
}
