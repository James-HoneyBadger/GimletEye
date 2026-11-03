import { describe, expect, it } from 'vitest';

import type { Session } from 'electron';

import { installSessionPolicy, isLocalScheme } from './session-policy.js';

describe('the session policy', () => {
  it('cancels anything that is not a local scheme', () => {
    const decisions: Record<string, boolean> = {};
    // Reinstall against a recorder so the handler can be called directly.
    let decide: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void = () => undefined;
    const recorder = {
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined,
      webRequest: { onBeforeRequest: (handler: typeof decide) => { decide = handler; } },
    };
    installSessionPolicy(recorder as unknown as Session);
    for (const url of [
      'https://example.com/x',
      'ws://127.0.0.1:9',
      'chrome-extension://abcdef/page.html',
      'file:///app/dist/index.html',
      'data:text/plain,hi',
    ]) {
      decide({ url }, (response) => {
        decisions[url] = response.cancel;
      });
    }
    expect(decisions['https://example.com/x']).toBe(true);
    expect(decisions['ws://127.0.0.1:9']).toBe(true);
    // No extension is ever loaded into this session, so a page served by one is
    // not local: the allowlist is the three schemes the app itself needs.
    expect(decisions['chrome-extension://abcdef/page.html']).toBe(true);
    expect(decisions['file:///app/dist/index.html']).toBe(false);
    expect(decisions['data:text/plain,hi']).toBe(false);
  });

  it('refuses every permission, requested or checked', () => {
    let request: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void = () => undefined;
    let check: (contents: unknown, permission: string) => boolean = () => true;
    const recorder = {
      setPermissionRequestHandler: (handler: typeof request) => { request = handler; },
      setPermissionCheckHandler: (handler: typeof check) => { check = handler; },
      webRequest: { onBeforeRequest: () => undefined },
    };
    installSessionPolicy(recorder as unknown as Session);

    const granted: boolean[] = [];
    for (const permission of ['notifications', 'clipboard-read', 'camera']) {
      request({}, permission, (value) => granted.push(value));
      expect(check({}, permission)).toBe(false);
    }
    expect(granted).toEqual([false, false, false]);
  });

  it('recognises the schemes the bundle needs', () => {
    expect(isLocalScheme('file:///app/index.html')).toBe(true);
    expect(isLocalScheme('blob:file:///x')).toBe(true);
    expect(isLocalScheme('http://127.0.0.1:5173')).toBe(false);
  });
});
