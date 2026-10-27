/**
 * The desktop host: Tauri's IPC on one side, `packages/core`'s `Host` on the
 * other.
 *
 * The webview cannot read a file, run `df`, or start a process. The shell crate
 * owns those four things and nothing else; everything the toolkit decides is
 * still decided in the shared TypeScript core, so the desktop and the CLI cannot
 * drift apart.
 */

import { invoke } from '@tauri-apps/api/core';

import { GimletError, asErrorCode } from '@gimlet-eye/core';
import type { EngineTransport, ExecResult, FileStat, Host, Platform } from '@gimlet-eye/core';

interface HostInfo {
  platform: Platform;
  arch: string;
  home: string;
  configDir: string;
  tmpDir: string;
}

interface ShellError {
  code?: string;
  message?: string;
}

/** Run a shell command, turning its error shape into the toolkit's error type. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const shell = error as ShellError;
    throw new GimletError(asErrorCode(shell.code), shell.message ?? String(error));
  }
}

export async function tauriHost(): Promise<Host> {
  const info = await call<HostInfo>('host_info');
  return {
    platform: info.platform,
    arch: info.arch,
    home: info.home,
    configDir: info.configDir,
    tmpDir: info.tmpDir,

    readTextFile: (path) => call('read_text_file', { path }),
    readFile: async (path) => Uint8Array.from(await call<number[]>('read_file', { path })),
    writeTextFile: (path, text) => call('write_text_file', { path, text }),
    writeFile: (path, bytes) => call('write_file', { path, bytes: [...bytes] }),
    createDir: (path) => call('create_dir', { path }),
    removeTree: (path) => call('remove_tree', { path }),
    exists: (path) => call('path_exists', { path }),
    stat: (path) => call<FileStat>('path_stat', { path }),
    readDir: (path) => call('read_dir', { path }),
    rename: (from, to) => call('rename_path', { from, to }),
    chmodOwnerOnly: (path) => call('chmod_owner_only', { path }),
    resolve: (path) => call('resolve_path', { path }),
    exec: (program, args) => call<ExecResult>('exec_command', { program, args: [...args] }),
    async engine(): Promise<EngineTransport> {
      const transport: EngineTransport = {
        request: (payload) => call('engine_request', { payload }),
        close: () => {
          // The shell owns the engine's lifetime: it is spawned on first use and
          // reaped when the app exits, so there is nothing to close per call.
        },
      };
      return transport;
    },
    now: () => new Date(),
  };
}
