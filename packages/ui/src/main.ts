import './style.css';
import { API_BASE, fetchHealth, fetchTools, runTool } from './api';
import type { Health, Report, ToolManifest } from './api';

interface State {
  tools: ToolManifest[];
  selectedId: string | null;
  health: Health | null;
  report: Report | null;
  error: string | null;
  running: boolean;
  dryRun: boolean;
}

const state: State = {
  tools: [],
  selectedId: null,
  health: null,
  report: null,
  error: null,
  running: false,
  dryRun: false,
};

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('missing #app root');
}
const app: HTMLDivElement = root;

const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

const selected = (): ToolManifest | null =>
  state.tools.find((tool) => tool.id === state.selectedId) ?? null;

function render(): void {
  const tool = selected();
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="logo" aria-hidden="true">M</span>
        <div>
          <h1>Mellivora ToolKit</h1>
          <p class="tagline">system · crypto · privacy</p>
        </div>
      </div>
      <div class="status" id="status">${renderStatus()}</div>
    </header>
    <main class="layout">
      <aside class="sidebar">${renderSidebar()}</aside>
      <section class="workbench">${renderWorkbench(tool)}</section>
    </main>
  `;
  bind();
}

function renderStatus(): string {
  if (state.error) {
    return `<span class="pill pill--error">offline</span><span class="muted">${escapeHtml(state.error)}</span>`;
  }
  if (!state.health) {
    return `<span class="pill">connecting…</span>`;
  }
  return `
    <span class="pill pill--ok">connected</span>
    <span class="muted">v${escapeHtml(state.health.version)} · ${state.health.tools} tools · ${state.health.packs} pack(s)</span>
    <span class="muted endpoint">${escapeHtml(API_BASE || location.origin)}</span>
  `;
}

function renderSidebar(): string {
  if (state.tools.length === 0) {
    return `<p class="muted pad">No tools loaded.</p>`;
  }

  const groups = new Map<string, ToolManifest[]>();
  for (const tool of state.tools) {
    const group = groups.get(tool.category) ?? [];
    group.push(tool);
    groups.set(tool.category, group);
  }

  return [...groups.entries()]
    .map(
      ([category, tools]) => `
      <div class="group">
        <h2>${escapeHtml(category)} <span class="count">${tools.length}</span></h2>
        ${tools
          .map(
            (tool) => `
          <button class="tool ${tool.id === state.selectedId ? 'tool--active' : ''}"
                  data-tool="${escapeHtml(tool.id)}"
                  title="${escapeHtml(tool.summary)}">
            <span class="tool-title">${escapeHtml(tool.title)}</span>
            <span class="tool-origin">${escapeHtml(tool.origin)}</span>
          </button>`,
          )
          .join('')}
      </div>`,
    )
    .join('');
}

function renderWorkbench(tool: ToolManifest | null): string {
  if (!tool) {
    return `<div class="empty"><h2>Select a tool</h2><p class="muted">Everything runs locally. Nothing leaves this machine.</p></div>`;
  }

  return `
    <div class="workbench-head">
      <div>
        <h2>${escapeHtml(tool.title)}</h2>
        <p class="muted">${escapeHtml(tool.summary)}</p>
        <p class="meta">
          <code>${escapeHtml(tool.id)}</code>
          ${(tool.capabilities ?? []).map((capability) => `<span class="chip">${escapeHtml(capability)}</span>`).join('')}
        </p>
      </div>
      <div class="controls">
        <label class="toggle">
          <input type="checkbox" id="dry-run" ${state.dryRun ? 'checked' : ''} />
          dry run
        </label>
        <button class="primary" id="run" ${state.running ? 'disabled' : ''}>
          ${state.running ? 'Running…' : 'Run'}
        </button>
      </div>
    </div>
    <form class="args" id="args">${renderArgs(tool)}</form>
    ${renderReport()}
  `;
}

function renderArgs(tool: ToolManifest): string {
  const args = tool.args ?? [];
  if (args.length === 0) {
    return `<p class="muted">No arguments.</p>`;
  }
  return args
    .map((spec) => {
      const id = `arg-${spec.name}`;
      const label = `<label for="${id}">${escapeHtml(spec.name)}${spec.required ? ' *' : ''}</label>`;
      const help = spec.help ? `<small>${escapeHtml(spec.help)}</small>` : '';
      let input: string;
      if (spec.type === 'boolean') {
        input = `<input type="checkbox" id="${id}" name="${escapeHtml(spec.name)}" data-type="boolean" ${
          spec.default === true ? 'checked' : ''
        } />`;
      } else if (spec.type === 'enum' && spec.values) {
        input = `<select id="${id}" name="${escapeHtml(spec.name)}" data-type="string">
          ${spec.values.map((value) => `<option>${escapeHtml(value)}</option>`).join('')}
        </select>`;
      } else {
        const type = spec.type === 'integer' ? 'number' : 'text';
        const placeholder = spec.type === 'path' ? '/path/to/file' : '';
        input = `<input type="${type}" id="${id}" name="${escapeHtml(spec.name)}" data-type="${spec.type}"
          placeholder="${placeholder}" value="${escapeHtml(spec.default ?? '')}" />`;
      }
      return `<div class="field">${label}${input}${help}</div>`;
    })
    .join('');
}

function renderReport(): string {
  if (!state.report) {
    return '';
  }
  const report = state.report;
  const findings = report.findings ?? [];
  const warnings = report.warnings ?? [];

  return `
    <article class="report report--${report.status}">
      <header>
        <span class="badge badge--${report.status}">${report.status}</span>
        <strong>${escapeHtml(report.summary)}</strong>
        <span class="muted">${report.duration_ms} ms</span>
      </header>
      ${
        findings.length
          ? `<ul class="findings">${findings
              .map(
                (finding) => `
            <li class="severity-${finding.severity}">
              <span class="sev">${finding.severity}</span>
              <code>${escapeHtml(finding.code)}</code>
              <span>${escapeHtml(finding.message)}</span>
            </li>`,
              )
              .join('')}</ul>`
          : ''
      }
      ${report.body ? `<pre class="body">${escapeHtml(report.body)}</pre>` : ''}
      ${report.data ? `<pre class="data">${escapeHtml(JSON.stringify(report.data, null, 2))}</pre>` : ''}
      ${warnings.length ? `<ul class="warnings">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}
    </article>
  `;
}

function bind(): void {
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.addEventListener('click', () => {
      state.selectedId = button.dataset.tool ?? null;
      state.report = null;
      render();
    });
  }

  const dryRun = app.querySelector<HTMLInputElement>('#dry-run');
  dryRun?.addEventListener('change', () => {
    state.dryRun = dryRun.checked;
  });

  app.querySelector<HTMLButtonElement>('#run')?.addEventListener('click', () => void run());
}

async function run(): Promise<void> {
  const tool = selected();
  if (!tool) {
    return;
  }

  const args: Record<string, unknown> = {};
  for (const input of app.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-type]')) {
    const kind = input.dataset.type;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      args[input.name] = input.checked;
      continue;
    }
    if (input.value === '') {
      continue;
    }
    args[input.name] = kind === 'integer' ? Number(input.value) : input.value;
  }

  state.running = true;
  state.error = null;
  render();

  try {
    state.report = await runTool(tool.id, args, state.dryRun);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
    render();
  }
}

async function boot(): Promise<void> {
  try {
    const [health, tools] = await Promise.all([fetchHealth(), fetchTools()]);
    state.health = health;
    state.tools = tools;
    state.selectedId = tools[0]?.id ?? null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  render();
}

void boot();
