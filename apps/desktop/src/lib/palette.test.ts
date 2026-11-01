import { describe, expect, it } from 'vitest';

import type { ToolManifest } from './engine';
import { paletteItems, rankPalette, stepIndex, type PaletteContext } from './palette';

const tools: ToolManifest[] = [
  {
    id: 'privacy.metadata-scan',
    title: 'Inspect metadata',
    summary: 'Report embedded EXIF, GPS, text, and comment regions in a container',
    category: 'privacy',
    args: [],
    tags: ['metadata'],
    capabilities: ['fs:read'],
  },
  {
    id: 'crypto.sha256',
    title: 'SHA-256 digest',
    summary: 'Hash text or a file',
    category: 'crypto',
    args: [],
    tags: ['hash'],
  },
];

const context: PaletteContext = {
  tool: tools[0] as ToolManifest,
  hasReport: true,
  dryRun: false,
  theme: 'dark',
  density: 'comfortable',
  categories: [{ name: 'privacy', count: 1 }],
};

const items = paletteItems(tools, context);

describe('the palette', () => {
  it('puts actions first, tools last', () => {
    expect(items[0]?.kind).toBe('action');
    expect(items.at(-1)?.kind).toBe('tool');
  });

  it('offers the actions that apply right now, and no others', () => {
    const ids = items.map((item) => item.id);
    expect(ids).toContain('action:run');
    expect(ids).toContain('action:edit');
    expect(ids).toContain('action:pin');
    // A read-only tool has no dry run to turn on.
    expect(ids).not.toContain('action:dry-run');
  });

  it('finds a tool through a misspelling', () => {
    expect(rankPalette(items, 'metdata scan')[0]?.id).toBe('tool:privacy.metadata-scan');
  });

  it('finds an action by what it says, not its id', () => {
    expect(rankPalette(items, 'diagnostics')[0]?.id).toBe('action:diagnostics');
    expect(rankPalette(items, 'dark theme').some((item) => item.id === 'action:theme')).toBe(true);
  });

  it('returns everything for an empty query', () => {
    expect(rankPalette(items, '   ')).toHaveLength(items.length);
  });

  it('does not invent a match', () => {
    expect(rankPalette(items, 'zzzzzzq')).toHaveLength(0);
  });
});

describe('stepping the highlight', () => {
  it('stops at the end of the list on screen', () => {
    expect(stepIndex(0, 20, 5)).toBe(4);
    expect(stepIndex(4, 1, 5)).toBe(4);
  });

  it('stops at the start', () => {
    expect(stepIndex(0, -3, 5)).toBe(0);
  });

  it('has somewhere safe to be when the ranking is empty', () => {
    expect(stepIndex(3, 1, 0)).toBe(0);
  });
});
