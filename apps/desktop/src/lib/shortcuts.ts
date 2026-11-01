/**
 * One table for the keyboard.
 *
 * The hints printed in the interface, the sheet that lists them, and the handler
 * that answers them are the same data, so a shortcut cannot be documented in one
 * place and dead in another.
 */

export type ShortcutId = 'palette' | 'run' | 'dry-run' | 'settings' | 'shortcuts';

export interface Shortcut {
  id: ShortcutId;
  label: string;
  keys: (mod: string) => string[];
  match: (event: KeyboardEvent) => boolean;
}

const mod = (event: KeyboardEvent): boolean => event.metaKey || event.ctrlKey;

export const SHORTCUTS: Shortcut[] = [
  {
    id: 'palette',
    label: 'Open the command palette',
    keys: (m) => [m, 'K'],
    match: (event) => mod(event) && event.key.toLowerCase() === 'k',
  },
  {
    id: 'run',
    label: 'Run the selected tool',
    keys: (m) => [m, '↵'],
    match: (event) => mod(event) && event.key === 'Enter' && !event.shiftKey,
  },
  {
    id: 'dry-run',
    label: 'Run with dry run',
    keys: (m) => [m, '⇧', '↵'],
    match: (event) => mod(event) && event.key === 'Enter' && event.shiftKey,
  },
  {
    id: 'settings',
    label: 'Settings and diagnostics',
    keys: (m) => [m, ','],
    match: (event) => mod(event) && event.key === ',',
  },
  {
    id: 'shortcuts',
    label: 'Show this list',
    keys: () => ['?'],
    match: (event) => !mod(event) && event.key === '?',
  },
];

/** Keys that have no single handler: they act on whatever has focus. */
const POINTER: { keys: string; label: string }[] = [
  { keys: '↑ ↓', label: 'Move through the palette or the tool list' },
  { keys: '↵', label: 'Choose the highlighted entry' },
  { keys: 'Esc', label: 'Close the palette, sheet, or report' },
];

export function shortcutFor(event: KeyboardEvent): ShortcutId | null {
  return SHORTCUTS.find((shortcut) => shortcut.match(event))?.id ?? null;
}

export interface ShortcutRow {
  keys: string;
  label: string;
}

export function shortcuts(keyLabel: string): ShortcutRow[] {
  return [
    ...SHORTCUTS.map((shortcut) => ({ keys: shortcut.keys(keyLabel).join(' '), label: shortcut.label })),
    ...POINTER,
  ];
}
