// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderSidebar } from './sidebar';
import { state, type AppState } from '../lib/store';
import type { ToolManifest } from '../lib/engine';

/** The store's live object, so the sidebar sees the shape it really gets. */
function withHealth(engine: string | null): AppState {
  return {
    ...state,
    tools: [],
    health:
      engine === null
        ? null
        : {
            status: 'ok',
            version: '0.7.0',
            engine,
            tools: 0,
            home: '/home/tester',
            config: '/home/tester/config.toml',
            audit: '/home/tester/audit.jsonl',
          },
  };
}

describe('the sidebar footer', () => {
  it('says the engine is built in rather than printing a sentinel as a version', () => {
    // `engine === 'none'` is how the runtime says every tool is in-process;
    // rendering it as "engine vnone" put an internal value into the interface.
    expect(renderSidebar(withHealth('none'))).toContain('engine built in');
    expect(renderSidebar(withHealth('none'))).not.toContain('vnone');
  });

  it('names a real engine version when there is one', () => {
    expect(renderSidebar(withHealth('0.7.0'))).toContain('engine v0.7.0');
  });

  it('says it is starting before the first health reply', () => {
    expect(renderSidebar(withHealth(null))).toContain('starting');
  });
});

describe('the catalogue runs', () => {
  const tool: ToolManifest = {
    id: 'demo.echo',
    title: 'Echo',
    summary: 'read a file',
    category: 'sysadmin',
    args: [],
  };

  const withRun = (status: 'ok' | 'warning' | 'error'): AppState => ({
    ...state,
    tools: [tool],
    pins: [],
    recents: [],
    history: [{ ts: new Date().toISOString(), tool: tool.id, status, duration_ms: 2 }],
  });

  it('says when a tool last ran', () => {
    expect(renderSidebar(withRun('ok'))).toContain('just now');
  });

  it('colours the age by the verdict', () => {
    expect(renderSidebar(withRun('warning'))).toContain('tool-run--warning');
    expect(renderSidebar(withRun('error'))).toContain('tool-run--error');
  });

  it('says nothing about a tool that has not run', () => {
    expect(renderSidebar({ ...state, tools: [tool], pins: [], recents: [], history: [] })).not.toContain('tool-run');
  });
});
