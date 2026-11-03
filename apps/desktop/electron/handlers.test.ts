import { describe, expect, it } from 'vitest';

import type { IpcMainInvokeEvent } from 'electron';

import type { DesktopApi, DoctorSnapshot, Health } from './api.js';
import { registerHandlers, type IpcSurface, type PickerMode } from './handlers.js';

const health: DoctorSnapshot = {
  status: 'ok',
  version: '1.0.0',
  engine: 'none',
  tools: 26,
  home: '/home/u/.config/gimlet',
  config: '/home/u/.config/gimlet/config.toml',
  audit: '/home/u/.config/gimlet/audit.jsonl',
  auditEnabled: true,
};

function harness(overrides: Partial<DesktopApi> = {}) {
  const channels = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const ipc: IpcSurface = { handle: (channel, listener) => channels.set(channel, listener) };
  const api: DesktopApi = {
    health: async () => health,
    doctor: async () => health,
    tools: async () => [],
    run: async (tool) => ({ tool, status: 'ok', summary: 'ran', duration_ms: 1 }),
    audit: async (limit) => ({ entries: [], path: health.audit, enabled: true, limit }),
    ...overrides,
  } as DesktopApi;
  const copies: string[] = [];
  const picks: PickerMode[] = [];
  const reveals: string[] = [];

  registerHandlers({
    ipc,
    api,
    isWindow: (event) => event.sender.id === 1,
    pick: async (mode) => {
      picks.push(mode);
      return { path: '/tmp/chosen' };
    },
    reveal: async (target) => {
      reveals.push(target);
      return { ok: true };
    },
    copy: (text) => copies.push(text),
  });

  const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
    Promise.resolve(channels.get(channel)?.({ sender: { id: 1 } } as unknown as IpcMainInvokeEvent, ...args));
  const raw = (channel: string, ...args: unknown[]): unknown =>
    channels.get(channel)?.({ sender: { id: 1 } } as unknown as IpcMainInvokeEvent, ...args);

  return { call, raw, copies, picks, reveals, channels };
}

describe('the IPC surface', () => {
  it('answers health and doctor with the runtime snapshot', async () => {
    const { call } = harness();
    await expect(call('gimlet-works:health')).resolves.toEqual(health);
    await expect(call('gimlet-works:doctor')).resolves.toEqual(health);
  });

  it('turns a failure into a message rather than an exception with a channel name', async () => {
    const { call } = harness({
      run: (async () => {
        throw new Error('not found: /nope');
      }) as never,
    });
    await expect(call('gimlet-works:run', 'crypto.sha256', { text: 'x' }, false)).resolves.toEqual({
      ok: false,
      message: 'not found: /nope',
    });
  });

  it('refuses an argument that is the wrong shape', async () => {
    const { call } = harness();
    await expect(call('gimlet-works:run', '', {}, false)).resolves.toEqual({
      ok: false,
      message: 'tool must be a non-empty string',
    });
    await expect(call('gimlet-works:run', 'crypto.sha256', {}, 'yes')).resolves.toEqual({
      ok: false,
      message: 'dryRun must be a boolean',
    });
    await expect(call('gimlet-works:pick', 'everything')).resolves.toEqual({
      ok: false,
      message: "mode must be 'file', 'directory', or 'either'",
    });
    await expect(call('gimlet-works:reveal', 42)).resolves.toEqual({
      ok: false,
      message: 'target must be a non-empty string',
    });
  });

  it('clamps the audit limit instead of trusting it', async () => {
    const { call } = harness();
    await expect(call('gimlet-works:audit', 0)).resolves.toMatchObject({ limit: 50 });
    await expect(call('gimlet-works:audit', 1.5)).resolves.toMatchObject({ limit: 50 });
    await expect(call('gimlet-works:audit', 7)).resolves.toMatchObject({ limit: 7 });
  });

  it('passes the picker mode through', async () => {
    const { call, picks } = harness();
    await expect(call('gimlet-works:pick', 'either')).resolves.toEqual({ path: '/tmp/chosen' });
    expect(picks).toEqual(['either']);
  });

  it('copies only reasonable text', async () => {
    const { call, copies } = harness();
    await expect(call('gimlet-works:copy', 'hello')).resolves.toEqual({ ok: true });
    expect(copies).toEqual(['hello']);
    await expect(call('gimlet-works:copy', 42)).resolves.toMatchObject({ ok: false });
    await expect(call('gimlet-works:copy', 'x'.repeat(1_000_001))).resolves.toEqual({
      ok: false,
      message: 'refusing to copy more than 1 MB',
    });
  });

  it('answers no sender but the window', async () => {
    const channels = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerHandlers({
      ipc: { handle: (channel, listener) => channels.set(channel, listener) },
      api: { health: async () => health } as DesktopApi,
      isWindow: (event) => event.sender.id === 1,
      pick: async () => ({ path: null }),
      reveal: async () => ({ ok: true }),
      copy: () => undefined,
    });
    const listener = channels.get('gimlet-works:health');
    const result = listener?.({ sender: { id: 2 } } as unknown as IpcMainInvokeEvent);
    await expect(Promise.resolve(result)).rejects.toThrow('unexpected sender');
  });
});
