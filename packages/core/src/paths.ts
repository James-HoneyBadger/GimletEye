/**
 * Where the toolkit keeps its state.
 *
 * Everything lives under one root, so a backup, a container mount, or a test
 * fixture is one path. `GIMLET_HOME` overrides it; otherwise it is
 * `<config dir>/gimlet`.
 */

import { join } from './pathutil.js';
import type { Host } from './host.js';

export interface AppPaths {
  root: string;
  configDir: string;
  configFile: string;
  dataDir: string;
  cacheDir: string;
  auditFile: string;
  keystoreFile: string;
}

/** Build the layout under an explicit root. */
export function pathsUnder(root: string): AppPaths {
  return {
    root,
    configDir: root,
    configFile: join(root, 'config.toml'),
    dataDir: join(root, 'data'),
    cacheDir: join(root, 'cache'),
    auditFile: join(root, 'audit.jsonl'),
    keystoreFile: join(root, 'keystore.gimlet'),
  };
}

/**
 * Resolve the root from the environment, falling back to the per-user config
 * directory.
 *
 * An installation that already has `~/.config/mellivora` keeps using it when
 * `~/.config/gimlet` does not exist yet: renaming the project must not strand a
 * keystore or an audit trail.
 */
export async function discoverPaths(host: Host, override?: string): Promise<AppPaths> {
  const fromEnv = override ?? envValue('GIMLET_HOME');
  if (fromEnv) return pathsUnder(fromEnv);

  const current = join(host.configDir, 'gimlet');
  const legacy = join(host.configDir, 'mellivora');
  if (!(await host.exists(current)) && (await host.exists(legacy))) {
    return pathsUnder(legacy);
  }
  return pathsUnder(current);
}

/**
 * A keystore sealed before the rename is read where it is, rather than at a new
 * name that does not exist yet.
 */
export async function keystorePath(paths: AppPaths, host: Host): Promise<string> {
  const legacy = join(paths.root, 'keystore.melv');
  if (!(await host.exists(paths.keystoreFile)) && (await host.exists(legacy))) return legacy;
  return paths.keystoreFile;
}

function envValue(name: string): string | undefined {
  // `process` is absent in a webview; the desktop host supplies the override
  // through its own settings instead.
  return typeof process === 'undefined' ? undefined : process.env[name];
}

/** Create the directories the toolkit writes into. */
export async function ensurePaths(paths: AppPaths, host: Host): Promise<void> {
  await host.createDir(paths.configDir);
  await host.createDir(paths.dataDir);
  await host.createDir(paths.cacheDir);
}
