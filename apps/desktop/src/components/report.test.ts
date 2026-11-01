// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Report, ToolManifest } from '../lib/engine';
import { state } from '../lib/store';
import { renderReport } from './report';

const scan: ToolManifest = {
  id: 'demo.scan',
  title: 'Scan a file',
  summary: 'report what is inside',
  category: 'privacy',
  args: [],
};

const strip: ToolManifest = {
  id: 'privacy.metadata-strip',
  title: 'Remove metadata',
  summary: 'rewrite a file',
  category: 'privacy',
  args: [],
  mutates: true,
};

const report: Report = {
  tool: 'demo.scan',
  status: 'warning',
  summary: '1 issue across 2 findings',
  duration_ms: 3,
  findings: [
    { severity: 'high', code: 'metadata.present', message: 'EXIF is present', target: '/a.jpg' },
    { severity: 'low', code: 'demo.other', message: 'A minor thing' },
  ],
  data: { path: '/a.jpg' },
};

let saved: {
  tools: ToolManifest[];
  selectedId: string | null;
  reports: Map<string, Report>;
  previous: Map<string, Report>;
  findingFilter: typeof state.findingFilter;
};

beforeEach(() => {
  saved = {
    tools: state.tools,
    selectedId: state.selectedId,
    reports: state.reports,
    previous: state.previous,
    findingFilter: state.findingFilter,
  };
  state.tools = [scan, strip];
  state.selectedId = scan.id;
  state.reports = new Map([[scan.id, report]]);
  state.previous = new Map();
  state.findingFilter = null;
  state.reportTab = 'findings';
});

afterEach(() => {
  state.tools = saved.tools;
  state.selectedId = saved.selectedId;
  state.reports = saved.reports;
  state.previous = saved.previous;
  state.findingFilter = saved.findingFilter;
});

describe('the findings section', () => {
  it('offers a chip for each severity that is present', () => {
    const html = renderReport(state);
    expect(html).toContain('data-finding-filter=""');
    expect(html).toContain('data-finding-filter="high"');
    expect(html).toContain('data-finding-filter="low"');
    // A severity nobody reported is not a filter.
    expect(html).not.toContain('data-finding-filter="critical"');
  });

  it('narrows the list to the chosen severity', () => {
    const codes = (html: string): string[] =>
      [...html.matchAll(/class="finding-code">([^<]+)</g)].map((match) => match[1] as string);

    expect(codes(renderReport(state))).toEqual(['metadata.present', 'demo.other']);

    state.findingFilter = 'low';
    expect(codes(renderReport(state))).toEqual(['demo.other']);
  });

  it('offers the tool that answers a known finding', () => {
    const html = renderReport(state);
    expect(html).toContain('data-suggest-tool="privacy.metadata-strip"');
    expect(html).toContain('Remove metadata');
  });

  it('copies only what the filter shows, as Markdown', () => {
    state.findingFilter = 'low';
    const filtered = renderReport(state);
    const match = /data-copy="(## demo\.scan[^"]*)"/.exec(filtered);
    expect(match?.[1]).toContain('demo.other');
    expect(match?.[1]).not.toContain('metadata.present');
  });

  it('copies the findings as Markdown', () => {
    const html = renderReport(state);
    const match = /data-copy="(## demo\.scan[^"]*)"/.exec(html);
    expect(match).not.toBeNull();
    expect(match?.[1]).toContain('- **high** `metadata.present`');
    expect(match?.[1]).toContain('/a.jpg');
  });
});

describe('the report header', () => {
  it('names the tool and states the verdict separately', () => {
    const html = renderReport(state);
    expect(html).toContain('<h1 tabindex="-1">Scan a file</h1>');
    expect(html).toContain('1 issue across 2 findings');
  });

  it('marks the whole values that differ between runs', () => {
    const html = renderReport(state);
    expect(html).toContain('data-volatile');
  });
});
