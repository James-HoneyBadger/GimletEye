/** A Host held in memory, so tests do not depend on the machine they run on. */

import type { EngineTransport, ExecResult, FileStat, Host } from '../src/host.js';
import type { Platform } from '../src/manifest.js';

export interface FakeHost extends Host {
  files: Map<string, string>;
  dirs: Set<string>;
  /** Stub engine replies, keyed by request `op`. */
  engineReplies: Map<string, unknown>;
  execResult: ExecResult;
  spawned: number;
  closed: number;
  /** Record of what was asked of the engine. */
  requests: unknown[];
  /** Permission bits by path, for tests that care about modes. */
  modes: Map<string, number>;
}

export function fakeHost(overrides: Partial<Host> = {}): FakeHost {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const modes = new Map<string, number>();
  const engineReplies = new Map<string, unknown>([
    ['handshake', { protocol_version: 1, version: '0.7.0' }],
    ['list', { tools: [] }],
  ]);

  const host: FakeHost = {
    platform: 'linux' as Platform,
    arch: 'aarch64',
    home: '/home/tester',
    configDir: '/home/tester/.config',
    tmpDir: '/tmp',
    files,
    dirs,
    engineReplies,
    execResult: { code: 0, stdout: '', stderr: '' },
    spawned: 0,
    closed: 0,
    requests: [],
    modes,

    async readTextFile(path) {
      const value = files.get(path);
      if (value === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return value;
    },
    async readFile(path) {
      return new TextEncoder().encode(await host.readTextFile(path));
    },
    async writeTextFile(path, text) {
      files.set(path, text);
      host.dirs.add(path.slice(0, path.lastIndexOf('/')));
    },
    async writeFile(path, bytes) {
      files.set(path, new TextDecoder().decode(bytes));
    },
    async createDir(path) {
      host.dirs.add(path);
    },
    async removeTree(path) {
      files.delete(path);
      host.dirs.delete(path);
    },
    async exists(path) {
      return files.has(path) || dirs.has(path);
    },
    async stat(path): Promise<FileStat> {
      if (files.has(path)) return { isFile: true, isDirectory: false, size: (files.get(path) ?? '').length };
      if (dirs.has(path)) return { isFile: false, isDirectory: true, size: 0 };
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    },
    async readDir(path) {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const names = new Set<string>();
      for (const file of files.keys()) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split('/')[0]!);
      }
      for (const dir of dirs) {
        if (dir.startsWith(prefix) && dir !== path) names.add(dir.slice(prefix.length).split('/')[0]!);
      }
      return [...names].filter((name) => name !== '');
    },
    async rename(from, to) {
      const value = files.get(from);
      if (value === undefined) throw Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' });
      files.delete(from);
      files.set(to, value);
    },
    async chmodOwnerOnly() {},
    async mode(path) {
      return modes.get(path);
    },
    async chmod(path, bits) {
      modes.set(path, bits);
    },
    async exec() {
      return host.execResult;
    },
    async resolve(path) {
      return path;
    },
    async engine(): Promise<EngineTransport> {
      host.spawned += 1;
      return {
        async request(payload) {
          host.requests.push(payload);
          const op = (payload as { op: string }).op;
          const reply = engineReplies.get(op);
          if (reply === undefined) throw new Error(`no reply for ${op}`);
          return { id: 1, ok: true, ...(reply as object) };
        },
        close() {
          host.closed += 1;
        },
      };
    },
    now() {
      return new Date('2026-10-27T00:00:00Z');
    },
    ...overrides,
  };

  return host;
}
