import { elapsed, escapeHtml, formatWhen, titleCase, truncate } from '../lib/format';
import { categories, lastRuns, type AppState, type RunSummary } from '../lib/store';
import type { Health, ToolManifest } from '../lib/engine';
import { categoryIcon, icons } from './icons';

function toolRow(tool: ToolManifest, state: AppState, lastRun: RunSummary | undefined): string {
  const active = tool.id === state.selectedId;
  const pinned = state.pins.includes(tool.id);
  return `
    <button class="tool${active ? ' tool--active' : ''}" data-tool="${escapeHtml(tool.id)}"
            role="option" aria-selected="${active}" tabindex="${active ? 0 : -1}"
            title="${escapeHtml(tool.summary)}${lastRun ? ` · last run ${formatWhen(lastRun.ts)} (${lastRun.status})` : ''}">
      <span class="tool-title">${escapeHtml(tool.title)}</span>
      <span class="tool-badges">
        ${pinned ? `<span class="tool-flag tool-flag--pin" title="Pinned">${icons.pin}</span>` : ''}
        ${tool.mutates ? '<span class="tool-flag" title="Writes to this machine">writes</span>' : ''}
        ${lastRun ? `<span class="tool-run tool-run--${escapeHtml(lastRun.status)}" data-volatile>${escapeHtml(elapsed(lastRun.ts))}</span>` : ''}
      </span>
      <span class="tool-summary">${escapeHtml(truncate(tool.summary, 110))}</span>
    </button>`;
}

function group(
  label: string,
  plain: string,
  tools: ToolManifest[],
  state: AppState,
  runs: Map<string, RunSummary>,
  attrs: string,
): string {
  if (tools.length === 0) return '';
  return `
    <section class="group" ${attrs}>
      <h2 class="group-title">${label}<span class="count">${tools.length}</span></h2>
      <div class="tool-list" role="listbox" aria-label="${escapeHtml(plain)} tools">${tools
        .map((tool) => toolRow(tool, state, runs.get(tool.id)))
        .join('')}</div>
    </section>`;
}

/**
 * What the footer says about the engine.
 *
 * `none` is the runtime's way of saying every tool is built in, and printing it
 * as a version ("engine vnone") is a sentinel leaking into the interface.
 */
function engineLabel(health: Health | null): string {
  if (health === null) return 'starting';
  return health.engine === 'none' ? 'engine built in' : `engine v${escapeHtml(health.engine)}`;
}

export function renderSidebar(state: AppState): string {
  // The catalogue is the whole pillar; finding a tool is the palette's job.
  const visible = state.tools.filter((tool) => !state.category || tool.category === state.category);

  const groups = categories(state.tools);
  const runs = lastRuns(state.history);

  const filters = `
    <div class="filters" role="tablist" aria-label="Filter by category">
      <button class="filter${state.category === null ? ' filter--active' : ''}" data-category=""
              role="tab" aria-selected="${state.category === null}">
        All <span class="count">${state.tools.length}</span>
      </button>
      ${groups
        .map(
          (group) => `
        <button class="filter${state.category === group.name ? ' filter--active' : ''}" data-category="${escapeHtml(group.name)}"
                role="tab" aria-selected="${state.category === group.name}">
          ${categoryIcon(group.name)}${escapeHtml(titleCase(group.name))} <span class="count">${group.count}</span>
        </button>`,
        )
        .join('')}
    </div>`;

  let list: string;
  if (visible.length === 0) {
    list = `<p class="sidebar-empty">${
      state.category ? `No ${escapeHtml(titleCase(state.category))} tools are available.` : 'No tools are available.'
    }</p>`;
  } else {
    // Pinned and recent tools are shortcuts into the same list, kept above it so
    // the catalogue below is always complete.
    const pinned = visible.filter((tool) => state.pins.includes(tool.id));
    const recent = state.recents
      .map((id) => visible.find((tool) => tool.id === id))
      .filter((tool): tool is ToolManifest => tool !== undefined)
      .filter((tool) => !state.pins.includes(tool.id));

    const buckets = new Map<string, ToolManifest[]>();
    for (const tool of visible) {
      const bucket = buckets.get(tool.category) ?? [];
      bucket.push(tool);
      buckets.set(tool.category, bucket);
    }
    // Same order as the filter chips above, so the list follows the tabs.
    const order = groups.map((group) => group.name).filter((name) => buckets.has(name));

    list = [
      group('Pinned', 'Pinned', pinned, state, runs, 'data-section="pinned"'),
      group('Recent', 'Recent', recent, state, runs, 'data-section="recent"'),
      ...order.map((category) =>
        group(
          `${categoryIcon(category)}${escapeHtml(titleCase(category))}`,
          titleCase(category),
          buckets.get(category) ?? [],
          state,
          runs,
          `data-group="${escapeHtml(category)}"`,
        ),
      ),
    ].join('');
  }

  return `
    <aside class="sidebar">
      ${filters}
      <div class="sidebar-scroll">${list}</div>
      <footer class="sidebar-footer">
        <span class="muted">${state.tools.length} tools</span>
        <span class="muted">${engineLabel(state.health)}</span>
      </footer>
    </aside>
  `;
}
