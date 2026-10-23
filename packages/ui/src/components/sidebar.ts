import { classifyTool, escapeHtml, isNative, titleCase, truncate } from '../lib/format';
import type { AppState } from '../lib/store';
import type { ToolManifest } from '../lib/api';
import { categoryIcon } from './icons';

function toolRow(tool: ToolManifest, selectedId: string | null): string {
  const active = tool.id === selectedId;
  return `
    <button class="tool${active ? ' tool--active' : ''}" data-tool="${escapeHtml(tool.id)}"
            role="option" aria-selected="${active}">
      <span class="tool-title">${escapeHtml(tool.title)}</span>
      ${isNative(tool.origin) ? '' : '<span class="tool-pack" title="Provided by a pack">pack</span>'}
      <span class="tool-summary">${escapeHtml(truncate(tool.summary, 110))}</span>
    </button>`;
}

export function renderSidebar(state: AppState): string {
  const visible = state.tools.filter((tool) => {
    if (state.category && tool.category !== state.category) return false;
    return classifyTool(tool, state.query);
  });

  const counts = new Map<string, number>();
  for (const tool of state.tools) {
    counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
  }
  const categoryNames = [...counts.keys()].sort();

  const filters = `
    <div class="filters" role="tablist" aria-label="Filter by category">
      <button class="filter${state.category === null ? ' filter--active' : ''}" data-category=""
              role="tab" aria-selected="${state.category === null}">
        All <span class="count">${state.tools.length}</span>
      </button>
      ${categoryNames
        .map(
          (name) => `
        <button class="filter${state.category === name ? ' filter--active' : ''}" data-category="${escapeHtml(name)}"
                role="tab" aria-selected="${state.category === name}">
          ${categoryIcon(name)}${escapeHtml(titleCase(name))} <span class="count">${counts.get(name)}</span>
        </button>`,
        )
        .join('')}
    </div>`;

  let list: string;
  if (visible.length === 0) {
    const scope = state.category ? ` in ${escapeHtml(titleCase(state.category))}` : '';
    list = `<p class="sidebar-empty">No tools match “${escapeHtml(state.query)}”${scope}.</p>`;
  } else if (state.category) {
    list = `<div class="tool-list" role="listbox">${visible
      .map((tool) => toolRow(tool, state.selectedId))
      .join('')}</div>`;
  } else {
    const groups = new Map<string, ToolManifest[]>();
    for (const tool of visible) {
      const bucket = groups.get(tool.category) ?? [];
      bucket.push(tool);
      groups.set(tool.category, bucket);
    }
    list = [...groups.entries()]
      .map(
        ([category, tools]) => `
        <section class="group">
          <h2 class="group-title">${categoryIcon(category)}${escapeHtml(titleCase(category))}<span class="count">${tools.length}</span></h2>
          <div class="tool-list" role="listbox">${tools
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
        <span class="muted">${state.packs.length} pack${state.packs.length === 1 ? '' : 's'}</span>
      </footer>
    </aside>
  `;
}
