import { describe, expect, it } from 'vitest';

import type { Session } from 'electron';

import { installSessionPolicy, isLocalScheme } from './session-policy.js';

interface FakeSession {
  setPermissionRequestHandler: (handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void) => void;
  setPermissionCheckHandler: (handler: (contents: unknown, permission: string) => boolean) => void;
  webRequest: { onBeforeRequest: (handler: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void) => void };
}

function fakeSession(): FakeSession & { decide(url: string): boolean; permission(name: string): boolean } {
  const fake: FakeSession & { decide(url: string): boolean; permission(name: string): boolean } = {
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    webRequest: { onBeforeRequest: () => undefined },
    decide: () => true,
    permission: () => true,
  };
  installSessionPolicy(fake as unknown as Session);
  return fake;
}

describe('the session policy', () => {
  it('cancels anything that is not a local scheme', () => {
    const session = fakeSession();
    const decisions: Record<string, boolean> = {};
    // Reinstall against a recorder so the handler can be called directly.
    let decide: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void = () => undefined;
    const recorder = {
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined,
      webRequest: { onBeforeRequest: (handler: typeof decide) => { decide = handler; } },
    };
    installSessionPolicy(recorder as unknown as Session);
    for (const url of ['https://example.com/x', 'ws://127.0.0.1:9', 'file:///app/dist/index.html', 'data:text/plain,hi']) {
      decide({ url }, (response) => {
        decisions[url] = response.cancel;
      });
    }
    expect(decisions['https://example.com/x']).toBe(true);
    expect(decisions['ws://127.0.0.1:9']).toBe(true);
    expect(decisions['file:///app/dist/index.html']).toBe(false);
    expect(decisions['data:text/plain,hi']).toBe(false);
    expect(session.decide('https://example.com')).toBe(true);
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
