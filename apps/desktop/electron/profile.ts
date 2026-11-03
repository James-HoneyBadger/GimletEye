import { statSync } from 'node:fs';
import { join } from 'node:path';

function directoryExists(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) throw new Error(`desktop profile is not a directory: ${path}`);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** Reuse the old profile rather than moving a directory another version may use. */
export function desktopProfilePath(current: string, appData: string): string {
  const currentExists = directoryExists(current);
  // Electron creates the new directory before loading main, even on first run.
  if (currentExists && ['window.json', 'Local Storage'].some((entry) => pathExists(join(current, entry)))) {
    return current;
  }
  for (const legacy of [join(appData, '@gimlet-eye', 'desktop'), join(appData, 'Gimlet Eye')]) {
    if (directoryExists(legacy)) return legacy;
  }
  return current;
}
