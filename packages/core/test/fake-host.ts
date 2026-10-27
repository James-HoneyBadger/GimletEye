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
  /** Bytes, for tools that stream rather than read whole files. */
  fileBytes: Map<string, Buffer>;
  /** Sizes of every ranged read and every append, so a test can prove boundeding. */
  reads: number[];
  writes: number[];
}

export function fakeHost(overrides: Partial<Host> = {}): FakeHost {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const modes = new Map<string, number>();
  const fileBytes = new Map<string, Buffer>();
  const reads: number[] = [];
  const writes: number[] = [];
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
    fileBytes,
    reads,
    writes,

    async readTextFile(path) {
      const value = files.get(path);
      if (value !== undefined) return value;
      const bytes = fileBytes.get(path);
      if (bytes === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return bytes.toString('utf8');
    },
    async readFile(path) {
      const bytes = fileBytes.get(path);
      if (bytes !== undefined) return new Uint8Array(bytes);
      return new TextEncoder().encode(await host.readTextFile(path));
    },
    async appendTextFile(path, text) {
      files.set(path, (files.get(path) ?? '') + text);
    },
    async appendFile(path, bytes) {
      const previous = host.fileBytes.get(path) ?? Buffer.alloc(0);
      host.fileBytes.set(path, Buffer.concat([previous, Buffer.from(bytes)]));
      host.writes.push(bytes.length);
    },
    async readRange(path, offset, length) {
      const all = host.fileBytes.get(path);
      if (all === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      host.reads.push(Math.min(length, Math.max(0, all.length - offset)));
      return new Uint8Array(all.subarray(offset, offset + length));
    },
    async writeTextFile(path, text) {
      files.set(path, text);
      host.dirs.add(path.slice(0, path.lastIndexOf('/')));
    },
    async writeFile(path, bytes) {
      // Bytes are the truth for anything read back; the text view exists because
      // older tests assert on content.
      fileBytes.set(path, Buffer.from(bytes));
      files.set(path, new TextDecoder().decode(bytes));
    },
    async createDir(path) {
      host.dirs.add(path);
    },
    async removeTree(path) {
      files.delete(path);
      fileBytes.delete(path);
      host.dirs.delete(path);
    },
    async exists(path) {
      return files.has(path) || dirs.has(path) || fileBytes.has(path);
    },
    async stat(path): Promise<FileStat> {
      const bytes = fileBytes.get(path);
      if (bytes !== undefined) return { isFile: true, isDirectory: false, size: bytes.length };
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
      const text = files.get(from);
      const bytes = fileBytes.get(from);
      if (text === undefined && bytes === undefined) {
        throw Object.assign(new Error(`ENOENT: ${from}`), { code: 'ENOENT' });
      }
      if (text !== undefined) {
        files.delete(from);
        files.set(to, text);
      }
      if (bytes !== undefined) {
        fileBytes.delete(from);
        fileBytes.set(to, bytes);
      }
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
