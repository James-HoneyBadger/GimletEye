// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderWorkbench } from './workbench';
import { state as bootState, type AppState } from '../lib/store';

const initial: AppState = { ...bootState, tools: [], error: null };

describe('empty state when the engine is unreachable', () => {
  it('explains the failure instead of looking empty', () => {
    const html = renderWorkbench({
      ...initial,
      tools: [],
      error: 'GET http://127.0.0.1:9/api/health failed',
    });
    expect(html).toContain('Cannot reach the engine');
    expect(html).toContain('127.0.0.1:9');
    expect(html).toContain('data-retry');
    expect(html).not.toContain('Pick a tool to begin');
  });

  it('still invites the user when the catalogue is merely empty', () => {
    const html = renderWorkbench({ ...initial, tools: [], error: null });
    expect(html).toContain('Pick a tool to begin');
    expect(html).not.toContain('Cannot reach the engine');
  });
});
