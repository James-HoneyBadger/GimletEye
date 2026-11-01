/**
 * What the window remembers between launches.
 *
 * Parsing lives here, as a pure function, so a new format version is a
 * migration with tests rather than a branch inside the store's import.
 */

export interface Preferences {
  theme?: 'dark' | 'light';
  density?: 'comfortable' | 'compact';
  dryRun?: boolean;
  selectedId?: string | null;
  category?: string | null;
  pins?: string[];
  recents?: string[];
}

export const PREFERENCES_KEY = 'gimlet.ui.v2';
export const LEGACY_PREFERENCES_KEY = 'gimlet.ui.v1';

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Coerce whatever was stored into the current shape.
 *
 * Unknown keys are dropped rather than carried: a preference the code no longer
 * reads is a value that would silently reappear if a later version reused the
 * name.
 */
export function migratePreferences(raw: unknown): Preferences {
  if (typeof raw !== 'object' || raw === null) return {};
  const value = raw as Record<string, unknown>;
  const next: Preferences = {};
  if (value['theme'] === 'dark' || value['theme'] === 'light') next.theme = value['theme'];
  if (value['density'] === 'compact' || value['density'] === 'comfortable') next.density = value['density'];
  if (typeof value['dryRun'] === 'boolean') next.dryRun = value['dryRun'];
  if (typeof value['selectedId'] === 'string' || value['selectedId'] === null) next.selectedId = value['selectedId'];
  if (typeof value['category'] === 'string' || value['category'] === null) next.category = value['category'];
  const pins = strings(value['pins']);
  if (pins) next.pins = pins;
  const recents = strings(value['recents']);
  if (recents) next.recents = recents;
  return next;
}

interface Readable {
  getItem(key: string): string | null;
}

function parse(storage: Readable, key: string): Preferences {
  try {
    return migratePreferences(JSON.parse(storage.getItem(key) ?? 'null'));
  } catch {
    return {};
  }
}

/**
 * Preferences from this version, or the last one.
 *
 * The legacy key is read, not deleted: someone who downgrades should find their
 * theme where they left it rather than a second first run.
 */
export function readPreferences(storage: Readable): Preferences {
  const current = parse(storage, PREFERENCES_KEY);
  if (Object.keys(current).length > 0) return current;
  return parse(storage, LEGACY_PREFERENCES_KEY);
}
