/**
 * What the toolkit needs from whatever it is running on.
 *
 * The CLI has Node: files, processes, and a child process for the engine. The
 * desktop app has a webview and a main process: the same operations arrive over IPC.
 * Everything above this interface — the registry, the report contract, the
 * config, the audit trail — is written once and does not care which it is.
 */

import type { Platform } from './manifest.js';

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** One request/response conversation with the verified engine. */
export interface EngineTransport {
  request(payload: unknown): Promise<unknown>;
  close(): void;
}

export interface Host {
  readonly platform: Platform;
  /** Machine architecture as the report spells it (`x86_64`, `aarch64`, …). */
  readonly arch: string;
  /** Absolute home directory. */
  readonly home: string;
  /** Directory holding per-user configuration (`~/.config` and its equivalents). */
  readonly configDir: string;
  readonly tmpDir: string;

  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  /**
   * Read up to `length` bytes from `offset`. A short read means end of file, and
   * an empty one means the offset is at or past it. This is what lets a tool
   * work on a file larger than memory.
   */
  readRange(path: string, offset: number, length: number): Promise<Uint8Array>;
  writeTextFile(path: string, text: string): Promise<void>;
  /** Append, creating the file if needed. Atomic for a single small write. */
  appendTextFile(path: string, text: string): Promise<void>;
  /** Append bytes, creating the file if needed. */
  appendFile(path: string, bytes: Uint8Array): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /**
   * Write a file and give it `mode`, whether it was created or already existed.
   *
   * Creating at the default mode and chmod'ing afterwards leaves a window in
   * which a secret key is world-readable, so tools that hold key material use
   * this instead.
   */
  writeFileMode(path: string, bytes: Uint8Array, mode: number): Promise<void>;
  /** Create `path` and its parents; succeeds when it already exists. */
  createDir(path: string): Promise<void>;
  /** Remove a file or a directory tree; succeeds when it does not exist. */
  removeTree(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;
  readDir(path: string): Promise<string[]>;
  /** Rename, replacing the destination. */
  rename(from: string, to: string): Promise<void>;
  /** Restrict a file to owner-only where the platform has modes. */
  chmodOwnerOnly(path: string): Promise<void>;
  /** The permission bits of a path, or `undefined` where the platform has none. */
  mode(path: string): Promise<number | undefined>;
  /** Set permission bits; a no-op where the platform has none. */
  chmod(path: string, mode: number): Promise<void>;
  exec(program: string, args: readonly string[]): Promise<ExecResult>;
  resolve(path: string): Promise<string>;
  /** Start the verified engine, or throw when it cannot be found. */
  engine(): Promise<EngineTransport>;
  now(): Date;
}
