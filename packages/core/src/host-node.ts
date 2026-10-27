/**
 * The CLI's host: Node's filesystem, child processes, and the sidecar engine.
 *
 * The desktop app has its own implementation of the same interface; nothing
 * above this file knows which one it has.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GimletError, asErrorCode, internal, io, notFound } from './errors.js';
import type { EngineTransport, ExecResult, FileStat, Host } from './host.js';
import type { Platform } from './manifest.js';

/** How long a single engine call may take before the surface gives up. */
const ENGINE_TIMEOUT_MS = 10 * 60 * 1000;

export function nodeHost(): Host {
  return {
    platform: nodePlatform(),
    arch: normaliseArch(process.arch),
    home: homedir(),
    configDir: defaultConfigDir(),
    tmpDir: tmpdir(),
    readTextFile: (path) => readFile(path, 'utf8'),
    readFile: async (path) => new Uint8Array(await readFile(path)),
    writeTextFile: (path, text) => writeFile(path, text, 'utf8'),
    writeFile: (path, bytes) => writeFile(path, bytes),
    createDir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    removeTree: async (path) => {
      await rm(path, { recursive: true, force: true });
    },
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    stat: async (path): Promise<FileStat> => {
      const info = await stat(path);
      return { isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size };
    },
    readDir: (path) => readdir(path),
    rename: (from, to) => rename(from, to),
    chmodOwnerOnly: async (path) => {
      // Windows has no mode bits to set; the file is already in the user's own
      // profile, which is the protection that exists there.
      if (nodePlatform() !== 'windows') await chmod(path, 0o600);
    },
    exec: (program, args) => execOnce(program, args),
    resolve: (path) => realpath(path),
    engine: async () => spawnEngine(),
    now: () => new Date(),
  };
}

/** The architecture names the report uses, which are Rust's rather than Node's. */
function normaliseArch(arch: string): string {
  switch (arch) {
    case 'x64':
      return 'x86_64';
    case 'arm64':
      return 'aarch64';
    case 'ia32':
      return 'x86';
    default:
      return arch;
  }
}

function nodePlatform(): Platform {
  switch (process.platform) {
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
}

function defaultConfigDir(): string {
  if (process.platform === 'win32') {
    return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
}

function execOnce(program: string, args: readonly string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(program, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        resolve({ code: 127, stdout, stderr: `${program}: not found` });
        return;
      }
      resolve({ code: 126, stdout, stderr: error.message });
    });
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/**
 * Where the engine binary lives.
 *
 * `GIMLET_SIDECAR` wins, then a binary installed next to the CLI, then the
 * build tree this checkout produced, then `PATH`.
 */
export function sidecarPath(): string {
  const override = process.env.GIMLET_SIDECAR;
  if (override) return override;

  const name = process.platform === 'win32' ? 'gimlet-sidecar.exe' : 'gimlet-sidecar';
  const beside = join(dirname(process.execPath), name);
  if (existsSync(beside)) return beside;

  for (const relative of ['target/release', 'target/debug']) {
    for (const root of checkoutRoots()) {
      const candidate = join(root, relative, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return name;
}

/** Directories from this module upwards that look like the source checkout. */
function checkoutRoots(): string[] {
  const roots: string[] = [];
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    roots.push(current);
    if (existsSync(join(current, 'Cargo.toml'))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function spawnEngine(): Promise<EngineTransport> {
  const binary = sidecarPath();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map<number, Pending>();
    let nextId = 1;
    let buffer = '';
    let stderr = '';
    let exited: string | null = null;

    const failAll = (error: Error) => {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          notFound(
            `engine not found at ${binary}. Build it with \`cargo build -p gimlet-eye-sidecar\` or set GIMLET_SIDECAR.`,
          ),
        );
        return;
      }
      reject(io(`cannot start the engine at ${binary}: ${error.message}`));
    });

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const at = buffer.indexOf('\n');
        if (at < 0) break;
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim() === '') continue;
        let message: { id?: number; ok?: boolean; error?: { code?: string; message?: string } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const entry = typeof message.id === 'number' ? pending.get(message.id) : undefined;
        if (!entry) continue;
        pending.delete(message.id!);
        clearTimeout(entry.timer);
        if (message.ok === false) {
          // The engine's code is carried through, so a surface can tell a bad
          // argument from a failed operation.
          entry.reject(new GimletError(asErrorCode(message.error?.code), message.error?.message ?? 'the engine refused the request'));
        } else {
          entry.resolve(message);
        }
      }
    });

    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('close', (code) => {
      exited = `the engine exited with status ${code ?? 'unknown'}${stderr ? `: ${stderr.trim()}` : ''}`;
      failAll(internal(exited));
    });

    const transport: EngineTransport = {
      request(payload) {
        if (exited) return Promise.reject(internal(exited));
        return new Promise((resolveRequest, rejectRequest) => {
          const id = nextId;
          nextId += 1;
          const timer = setTimeout(() => {
            pending.delete(id);
            rejectRequest(io(`the engine did not answer within ${ENGINE_TIMEOUT_MS / 1000}s`));
          }, ENGINE_TIMEOUT_MS);
          pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
          child.stdin.write(`${JSON.stringify({ ...(payload as object), id })}\n`);
        });
      },
      close() {
        child.stdin.end();
        child.kill();
      },
    };
    resolve(transport);
  });
}
