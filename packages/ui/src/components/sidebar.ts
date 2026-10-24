import { escapeHtml, isNative, matchesQuery, titleCase, truncate } from '../lib/format';
import { categories, type AppState } from '../lib/store';
import type { ToolManifest } from '../lib/api';
import { categoryIcon } from './icons';

function toolRow(tool: ToolManifest, selectedId: string | null): string {
  const active = tool.id === selectedId;
  return `
    <button class="tool${active ? ' tool--active' : ''}" data-tool="${escapeHtml(tool.id)}"
            role="option" aria-selected="${active}" tabindex="${active ? 0 : -1}"
            title="${escapeHtml(tool.summary)}">
      <span class="tool-title">${escapeHtml(tool.title)}</span>
      <span class="tool-badges">
        ${tool.mutates ? '<span class="tool-flag" title="Writes to this machine">writes</span>' : ''}
        ${isNative(tool.origin) ? '' : '<span class="tool-pack" title="Provided by a pack">pack</span>'}
      </span>
      <span class="tool-summary">${escapeHtml(truncate(tool.summary, 110))}</span>
    </button>`;
}

export function renderSidebar(state: AppState): string {
  const visible = state.tools.filter((tool) => {
    if (state.category && tool.category !== state.category) return false;
    return matchesQuery(tool, state.query);
  });

  const groups = categories();

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
    const scope = state.category ? ` in ${escapeHtml(titleCase(state.category))}` : '';
    list = state.query
      ? `<p class="sidebar-empty">No tools match “${escapeHtml(state.query)}”${scope}.
           <button class="link-button" data-clear-search>Clear search</button></p>`
      : `<p class="sidebar-empty">No tools in this category.</p>`;
  } else {
    const buckets = new Map<string, ToolManifest[]>();
    for (const tool of visible) {
      const bucket = buckets.get(tool.category) ?? [];
      bucket.push(tool);
      buckets.set(tool.category, bucket);
    }
    list = [...buckets.entries()]
      .map(
        ([category, tools]) => `
        <section class="group">
          <h2 class="group-title">${categoryIcon(category)}${escapeHtml(titleCase(category))}<span class="count">${tools.length}</span></h2>
          <div class="tool-list" role="listbox" aria-label="${escapeHtml(titleCase(category))} tools">${tools
            .map((tool) => toolRow(tool, state.selectedId))
            .join('')}</div>
        </section>`,
      )
      .join('');
  }

  return `
    <aside class="sidebar">
      ${filters}
      <div class="sidebar-scroll">${list}</div>
      <footer class="sidebar-footer">
        <span class="muted">${state.tools.length} tools</span>
        <button class="link-button" data-sheet="packs">
          ${state.packs.length} pack${state.packs.length === 1 ? '' : 's'}
        </button>
      </footer>
    </aside>
  `;
}
