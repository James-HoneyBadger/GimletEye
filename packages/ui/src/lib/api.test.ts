// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('sends the token once one is set', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ status: 'ok' }) } as Response;
    });

    const api = await import('./api');
    api.setApiToken('abc123');
    await api.fetchHealth();

    expect(new Headers(calls[0]?.headers).get('authorization')).toBe('Bearer abc123');
  });

  it('sends no authorization header without a token', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ status: 'ok' }) } as Response;
    });

    const api = await import('./api');
    await api.fetchHealth();

    expect(new Headers(calls[0]?.headers).get('authorization')).toBeNull();
  });

  it('reports a 401 as UnauthorizedError', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        ({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => null,
        }) as Response,
    );

    const api = await import('./api');
    await expect(api.fetchHealth()).rejects.toBeInstanceOf(api.UnauthorizedError);
  });

  it('takes the token from the URL fragment and strips it', async () => {
    window.location.hash = '#token=fromfrag';
    const api = await import('./api');

    expect(api.hasApiToken()).toBe(true);
    expect(window.location.hash).toBe('');
    expect(localStorage.getItem('gimlet.api.token')).toBe('fromfrag');
  });

  it('prefers a token injected by the desktop shell', async () => {
    window.__GIMLET_TOKEN__ = 'injected';
    window.location.hash = '#token=fromfrag';
    const api = await import('./api');

    expect(api.hasApiToken()).toBe(true);
    expect(window.location.hash).toBe('#token=fromfrag');

    delete window.__GIMLET_TOKEN__;
  });
});
