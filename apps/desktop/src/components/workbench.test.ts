// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolManifest } from '../lib/engine';
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

describe('a field the manifest calls a secret', () => {
  const tool: ToolManifest = {
    id: 'crypto.encrypt',
    title: 'Encrypt',
    summary: 'seal a file',
    category: 'crypto',
    args: [
      { name: 'input', type: 'path', required: true },
      { name: 'passphrase', type: 'string' },
      { name: 'passphrase_env', type: 'string' },
    ],
  };

  // `renderWorkbench` reads the selection from the store, so the test selects
  // the tool there and puts the store back afterwards.
  const previous = { tools: bootState.tools, selectedId: bootState.selectedId };

  beforeEach(() => {
    bootState.tools = [tool];
    bootState.selectedId = tool.id;
  });

  afterEach(() => {
    bootState.tools = previous.tools;
    bootState.selectedId = previous.selectedId;
  });

  const tag = (name: string): string =>
    new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(renderWorkbench(bootState))?.[0] ?? '';

  it('masks the value and keeps the password manager out of it', () => {
    expect(tag('passphrase')).toContain('type="password"');
    expect(tag('passphrase')).toContain('autocomplete="new-password"');
  });

  it('leaves a plain path and an environment-variable name readable', () => {
    expect(tag('input')).toContain('type="text"');
    // The variable's name is not the secret; hiding it would make the field
    // impossible to check.
    expect(tag('passphrase_env')).toContain('type="text"');
  });
});
