/**
 * The command palette: tools and actions behind one field.
 *
 * Ranking is deliberately forgiving. A trigram comparison already exists in the
 * core registry for tool-name matching, so "metdata" finds "Inspect metadata"
 * instead of asking the user to spell.
 */

import { similarity } from '@gimlet-works/core';

import type { ToolManifest } from './engine';
import { modLabel, searchText } from './format';
import type { Density, Theme } from './store';

export interface PaletteItem {
  id: string;
  kind: 'tool' | 'action';
  title: string;
  detail: string;
  /** Words a person would reach for that the title does not contain. */
  keywords?: string;
  shortcut?: string;
}

export interface PaletteContext {
  tool: ToolManifest | null;
  hasReport: boolean;
  dryRun: boolean;
  theme: Theme;
  density: Density;
  categories: { name: string; count: number }[];
}

const mod = modLabel;

/** Actions first: they are what a returning user opens the palette for. */
export function paletteActions(context: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = [];
  const tool = context.tool;

  if (tool) {
    items.push({
      id: 'action:run',
      kind: 'action',
      title: `Run ${tool.title}`,
      detail: tool.mutates && context.dryRun ? 'Dry run is on for this run' : 'Run the tool with the values on screen',
      keywords: 'execute start go',
      shortcut: `${mod} ↵`,
    });
    if (tool.mutates) {
      items.push({
        id: 'action:dry-run',
        kind: 'action',
        title: context.dryRun ? 'Turn dry run off' : 'Turn dry run on',
        detail: 'A dry run reports what would happen and writes nothing',
        keywords: 'preview safe write',
      });
    }
  }
  if (context.hasReport && tool) {
    items.push({
      id: 'action:edit',
      kind: 'action',
      title: 'Edit parameters',
      detail: 'Back to the form, with the values you used',
      keywords: 'back form values compose',
    });
    items.push({
      id: 'action:copy-cli',
      kind: 'action',
      title: 'Copy the CLI command',
      detail: 'The same run, as a command line',
      keywords: 'shell terminal command line',
    });
  }
  if (tool) {
    items.push({
      id: 'action:pin',
      kind: 'action',
      title: 'Pin or unpin this tool',
      detail: 'Pinned tools stay at the top of the list',
      keywords: 'favourite favorite star keep',
    });
  }

  items.push({
    id: 'action:theme',
    kind: 'action',
    title: `Switch to the ${context.theme === 'dark' ? 'light' : 'dark'} theme`,
    detail: 'The window follows this, not the desktop',
    keywords: 'appearance dark light mode colour scheme',
  });
  items.push({
    id: 'action:density',
    kind: 'action',
    title: context.density === 'compact' ? 'Use comfortable spacing' : 'Use compact spacing',
    detail: 'Changes row height, never type size',
    keywords: 'density compact comfortable rows',
  });
  items.push({
    id: 'action:history',
    kind: 'action',
    title: 'Recent runs',
    detail: 'The local audit trail, argument names only',
    keywords: 'audit trail log history',
  });
  items.push({
    id: 'action:diagnostics',
    kind: 'action',
    title: 'Settings and diagnostics',
    detail: 'Version, engine, and where data lives',
    keywords: 'paths home config audit version about preferences',
    shortcut: `${mod} ,`,
  });
  items.push({
    id: 'action:shortcuts',
    kind: 'action',
    title: 'Keyboard shortcuts',
    detail: 'Everything the keyboard can do',
    keywords: 'keys help bindings',
    shortcut: '?',
  });

  for (const category of context.categories) {
    items.push({
      id: `action:category:${category.name}`,
      kind: 'action',
      title: `Show ${category.name} tools`,
      detail: `${category.count} in this pillar`,
      keywords: `filter ${category.name}`,
    });
  }

  return items;
}

export function paletteTools(tools: ToolManifest[]): PaletteItem[] {
  return tools.map((tool) => ({
    id: `tool:${tool.id}`,
    kind: 'tool',
    title: tool.title,
    detail: `${tool.id} · ${tool.summary}`,
    // Everything the old search box matched, plus the id split on its
    // punctuation: people type `metadata-scan`, not `privacy.metadata-scan`.
    keywords: `${tool.id.replace(/[.:/-]+/g, ' ')} ${searchText(tool)}`,
  }));
}

/** What an entry does when chosen: the id is the only thing that knows. */
export type PaletteTarget = { kind: 'tool'; id: string } | { kind: 'action'; name: string };

export function actionOf(item: PaletteItem): PaletteTarget {
  return item.id.startsWith('tool:')
    ? { kind: 'tool', id: item.id.slice('tool:'.length) }
    : { kind: 'action', name: item.id.slice('action:'.length) };
}

/** Everything the palette can do right now, actions first. */
export function paletteItems(tools: ToolManifest[], context: PaletteContext): PaletteItem[] {
  return [...paletteActions(context), ...paletteTools(tools)];
}

/**
 * Prefix matches first, then substrings, then every word, then trigrams.
 *
 * The last step is what forgives "metdata": a typo in one word still leaves the
 * other word exact, and the trigram comparison carries the rest.
 */
export function score(item: PaletteItem, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle === '') return 1;
  const title = item.title.toLowerCase();
  if (title.startsWith(needle)) return 1;
  if (title.includes(needle)) return 0.9;

  const haystack = `${item.detail} ${item.keywords ?? ''}`.toLowerCase();
  if (haystack.includes(needle)) return 0.8;

  const words = needle.split(/\s+/).filter((word) => word !== '');
  const text = `${title} ${haystack}`;
  if (words.every((word) => text.includes(word))) return 0.7;

  // Trigrams only see names and keywords: a fuzzy match inside a prose detail
  // line is how "theme" used to find "what this host sets them to".
  const candidates = `${title} ${item.keywords ?? ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  // Average over the query's words, not the best of them: "metdata scan" must
  // not rank an action that happens to contain the word "metadata".
  let total = Math.max(similarity(needle, title), similarity(needle, text));
  for (const word of words) {
    let best = 0;
    for (const candidate of candidates) best = Math.max(best, similarity(word, candidate));
    total += best;
  }
  return total / (words.length + 1);
}

/**
 * Move a highlight inside a list that may have shrunk under it.
 *
 * The palette re-ranks on every keystroke, so the index has to be measured
 * against the list that is on screen, not the one that was there before.
 */
export function stepIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index + delta, 0), length - 1);
}

export function rankPalette(items: PaletteItem[], query: string): PaletteItem[] {
  if (query.trim() === '') return items;
  return items
    .map((item) => ({ item, value: score(item, query) }))
    .filter((entry) => entry.value >= 0.3)
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.item);
}
