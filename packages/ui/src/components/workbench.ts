import type { ArgSpec, ToolManifest } from '../lib/api';
import { escapeHtml, isNative, modLabel, originLabel, titleCase } from '../lib/format';
import { draftFor, selectedTool, type AppState, type RawValues } from '../lib/store';
import { icons } from './icons';
import { renderResult } from './result';

/** Above this many values an enum stays a dropdown. */
const SEGMENT_LIMIT = 4;

/**
 * A radio group styled as buttons. Real radios, so arrow keys, the label click
 * target, and screen readers all behave; the styling is what makes it a
 * segmented control.
 */
function segmented(
  spec: ArgSpec,
  values: string[],
  id: string,
  raw: string,
  error: string | undefined,
): string {
  const describedBy = error ? ` aria-describedby="${id}-error"` : '';
  return `<div class="choice-group${error ? ' choice-group--invalid' : ''}" role="radiogroup"
      aria-labelledby="${id}-label"${describedBy}>
    ${values
      .map(
        (value, index) => `
      <label class="choice${value === raw ? ' is-active' : ''}">
        <input type="radio" class="choice-input" name="${escapeHtml(spec.name)}" value="${escapeHtml(value)}"
               data-type="string" id="${id}-${index}" ${value === raw ? 'checked' : ''} />
        <span class="choice-label">${escapeHtml(value)}</span>
      </label>`,
      )
      .join('')}
  </div>`;
}

function field(spec: ArgSpec, draft: RawValues, error: string | undefined): string {
  const id = `arg-${spec.name}`;
  const invalid = error ? ' input--invalid' : '';
  const label = `<label for="${id}" id="${id}-label">${escapeHtml(titleCase(spec.name))}${spec.required ? '<span class="required" title="Required">*</span>' : ''}</label>`;
  const help = spec.help ? `<p class="field-help">${escapeHtml(spec.help)}</p>` : '';
  const message = error
    ? `<p class="field-error" id="${id}-error">${escapeHtml(error)}</p>`
    : '';
  const describedBy = error ? ` aria-describedby="${id}-error" aria-invalid="true"` : '';
  const type = spec.type;
  const fallback = spec.default === undefined || spec.default === null ? '' : String(spec.default);
  const draftValue = draft[spec.name];
  const raw = draftValue === undefined ? fallback : String(draftValue);

  let control: string;
  if (type === 'boolean') {
    const on = draftValue === undefined ? spec.default === true : draftValue === true;
    const checked = on ? 'checked' : '';
    control = `
      <label class="switch" for="${id}">
        <input type="checkbox" id="${id}" name="${escapeHtml(spec.name)}" data-type="boolean" ${checked} />
        <span class="switch-track"><span class="switch-thumb"></span></span>
        <span class="switch-text">${checked ? 'Enabled' : 'Disabled'}</span>
      </label>`;
  } else if (type === 'enum' && spec.values?.length) {
    // A short list is a set of buttons, not a dropdown: every option is
    // reachable in one click, and the native popup a `<select>` needs is exactly
    // what WebKitGTK refuses to show reliably inside a Tauri window. Longer
    // lists keep the select so a field cannot turn into a wall of chips.
    control =
      spec.values.length <= SEGMENT_LIMIT
        ? segmented(spec, spec.values, id, raw, error)
        : `<select id="${id}" name="${escapeHtml(spec.name)}" data-type="string"${describedBy}>
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
    control = `<input class="input${mono}${invalid}" type="${inputType}" id="${id}" name="${escapeHtml(spec.name)}"
      data-type="${type}" placeholder="${placeholder}" value="${escapeHtml(raw)}" spellcheck="false"
      autocomplete="off"${describedBy} />`;
  }

  return `<div class="field field--${type}">${label}${control}${help}${message}</div>`;
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

function dryRunControls(tool: ToolManifest, state: AppState): string {
  if (!tool.mutates) {
    return `
      <span class="readonly" title="This tool only reads from this machine">
        ${icons.shield}Read-only
      </span>`;
  }
  return `
    <label class="switch" for="dry-run">
      <input type="checkbox" id="dry-run" ${state.dryRun ? 'checked' : ''} />
      <span class="switch-track"><span class="switch-thumb"></span></span>
      <span class="switch-text">Dry run</span>
    </label>`;
}

function tokenGate(): string {
  return `
    <section class="panel result--idle token-gate">
      <h1 class="tool-name">API token required</h1>
      <p class="muted">This engine was started with <code>[api] require_token</code> on.
        Paste the token printed by <code>mellivora serve</code>, or the contents of
        <code>api-token</code> in the toolkit home.</p>
      <form id="token-form" class="token-form" autocomplete="off">
        <input class="input input--mono" id="api-token-input" name="token" type="password"
               placeholder="64 hex characters" spellcheck="false" aria-label="API token" />
        <button class="button button--primary" type="submit">Unlock</button>
      </form>
    </section>`;
}

export function renderWorkbench(state: AppState): string {
  if (state.tokenRequired) {
    return `<main class="main">${tokenGate()}</main>`;
  }

  const tool = selectedTool();
  if (!tool) {
    return `<main class="main">${emptyState()}</main>`;
  }

  const args = tool.args ?? [];
  const capabilities = (tool.capabilities ?? []).map((capability) => `<span class="chip">${escapeHtml(capability)}</span>`).join('');
  const platforms = (tool.platforms ?? [])
    .map((platform) => `<span class="chip chip--quiet" title="Runs on ${escapeHtml(platform)} only">${escapeHtml(platform)}</span>`)
    .join('');
  const tags = (tool.tags ?? []).slice(0, 4).map((tag) => `<span class="chip chip--quiet">${escapeHtml(tag)}</span>`).join('');
  const errors = state.errors;
  const draft = draftFor(tool.id);

  return `
    <main class="main">
      <section class="tool-head">
        <div class="tool-head-top">
          <div>
            <h1 class="tool-name">${escapeHtml(tool.title)}</h1>
            <p class="tool-summary">${escapeHtml(tool.summary)}</p>
          </div>
          <div class="tool-badges">
            ${tool.mutates ? `<span class="badge badge--writes" title="This tool can write to this machine">${icons.warning}writes</span>` : ''}
            <span class="badge ${isNative(tool.origin) ? 'badge--native' : 'badge--pack'}">${escapeHtml(originLabel(tool.origin))}</span>
          </div>
        </div>

        <div class="tool-meta">
          <code class="tool-id">${escapeHtml(tool.id)}</code>
          <button class="icon-button icon-button--tiny" data-copy="${escapeHtml(tool.id)}" title="Copy tool id" aria-label="Copy tool id">
            ${icons.copy}
          </button>
          ${platforms}
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
          : `<form class="args-grid panel-body" id="args" autocomplete="off" novalidate>${args
              .map((spec) => field(spec, draft, errors[spec.name]))
              .join('')}</form>`}
      </section>

      <section class="actionbar">
        ${dryRunControls(tool, state)}
        <span class="actionbar-spacer"></span>
        <span class="kbd-hint"><kbd>${modLabel}</kbd><kbd>↵</kbd></span>
        <button class="button button--primary" id="run" ${state.running ? 'disabled' : ''}>
          ${state.running ? '<span class="spinner" aria-hidden="true"></span>Running…' : `${icons.play}Run`}
        </button>
      </section>

      <div id="result-region">${renderResult(state)}</div>
    </main>`;
}
