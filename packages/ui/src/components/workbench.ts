import type { ArgSpec, ToolManifest } from '../lib/api';
import { escapeHtml, isNative, modLabel, originLabel, titleCase } from '../lib/format';
import {
  categories,
  draftFor,
  selectedTool,
  type AppState,
  type RawValues,
} from '../lib/store';
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

/** What each pillar covers, in the words the empty state has always used. */
const PILLARS: { category: string; label: string; blurb: string }[] = [
  { category: 'sysadmin', label: 'System', blurb: 'Inventory, disk capacity, host checks' },
  { category: 'crypto', label: 'Crypto', blurb: 'Encrypt files, sign and verify, generate secrets' },
  { category: 'privacy', label: 'Privacy', blurb: 'Inspect and remove metadata, redact GPS' },
];

/**
 * The "nothing selected yet" screen.
 *
 * The pillar cards are buttons, not decoration: they used to be plain `div`s
 * shaped like cards, so the most inviting thing on the screen did nothing when
 * clicked. Each one narrows the catalogue to its pillar and opens the first tool
 * in it, which is the shortest path from "where do I start" to a working form.
 */
function emptyState(state: AppState): string {
  const counts = new Map(categories().map((entry) => [entry.name, entry.count]));
  const extra = categories()
    .filter((entry) => !PILLARS.some((pillar) => pillar.category === entry.name))
    .map((entry) => ({
      category: entry.name,
      label: titleCase(entry.name),
      blurb: `${entry.count} tool${entry.count === 1 ? '' : 's'}`,
      count: entry.count,
    }));

  const cards = [
    ...PILLARS.map((pillar) => ({ ...pillar, count: counts.get(pillar.category) ?? 0 })),
    ...extra,
  ]
    .map((card) => {
      // Nothing loaded yet is a real state - a slow start or an unreachable
      // engine - and a button that cannot go anywhere has to say so instead of
      // looking alive.
      const empty = card.count === 0;
      const attrs = empty
        ? 'disabled title="No tools loaded yet"'
        : `data-open-category="${escapeHtml(card.category)}"`;
      return `
        <button type="button" class="hint-card${empty ? ' hint-card--empty' : ''}" ${attrs}>
          <strong>${escapeHtml(card.label)}<span class="hint-count">${card.count}</span></strong>
          <span class="hint-blurb">${escapeHtml(card.blurb)}</span>
        </button>`;
    })
    .join('');

  // A failed boot used to look identical to a healthy empty catalogue: an empty
  // list and greyed-out pillars, with the reason hidden in a region that is not
  // rendered when no tool is selected. Say what went wrong where the user is
  // looking, and offer the one action that can help.
  const failure = state.error
    ? `
      <div class="callout callout--error empty-failure" role="alert">
        <strong>${icons.error}Cannot reach the engine</strong>
        <p>${escapeHtml(state.error)}</p>
        <button class="button" data-retry>Try again</button>
      </div>`
    : '';

  const intro = state.error
    ? 'The toolkit could not load its catalogue, so there is nothing to run yet.'
    : 'Everything runs locally against this machine. Choose a pillar below, pick a tool on the left, or press';

  return `
    <section class="empty-state">
      <div class="empty-art" aria-hidden="true">${icons.layers}</div>
      <h1>${state.error ? 'No engine, no tools' : 'Pick a tool to begin'}</h1>
      <p class="muted">${intro}${state.error ? '' : ` <kbd>${modLabel} K</kbd> and start typing.`}</p>
      ${failure}
      <div class="empty-hints">${cards}</div>
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
        Paste the token printed by <code>gimlet serve</code>, or the contents of
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
    return `<main class="main">${emptyState(state)}</main>`;
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
