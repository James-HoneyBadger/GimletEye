/** `⌘` on macOS, `Ctrl` elsewhere. */
export const modLabel: string =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function humanDuration(millis: number): string {
  if (millis < 1000) return `${millis} ms`;
  if (millis < 60_000) return `${(millis / 1000).toFixed(2)} s`;
  const minutes = Math.floor(millis / 60_000);
  const seconds = Math.round((millis % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** Human label for a tool origin: `builtin` → Native, `plugin:x` → Pack: x */
export function originLabel(origin: string): string {
  if (origin === 'builtin') return 'Native';
  if (origin.startsWith('plugin:')) return `Pack · ${origin.slice('plugin:'.length)}`;
  return origin;
}

export function isNative(origin: string): boolean {
  return origin === 'builtin';
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

interface Searchable {
  id: string;
  title: string;
  summary: string;
  tags?: string[];
  capabilities?: string[];
  platforms?: string[];
  origin?: string;
  args?: { name: string; help?: string }[];
}

/**
 * Every part of a manifest a user might remember: what it is called, what it
 * touches, and which arguments it takes.
 */
export function searchText(tool: Searchable): string {
  return [
    tool.id,
    tool.title,
    tool.summary,
    tool.origin ?? '',
    ...(tool.tags ?? []),
    ...(tool.capabilities ?? []),
    ...(tool.platforms ?? []),
    ...(tool.args ?? []).flatMap((arg) => [arg.name, arg.help ?? '']),
  ]
    .join(' ')
    .toLowerCase();
}

export function matchesQuery(tool: Searchable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = searchText(tool);
  return needle.split(/\s+/).every((part) => haystack.includes(part));
}

/** Quote a shell argument only when it needs it, so copies stay readable. */
function shellArg(value: unknown): string {
  const text = String(value ?? '');
  if (text === '') return "''";
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command a user would type to reproduce this run. The workbench and the
 * CLI are two views of one engine, so a run is never trapped in the window.
 */
export function cliCommand(toolId: string, args: Record<string, unknown>, dryRun: boolean): string {
  const parts = ['mellivora', 'run', toolId];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === '') continue;
    parts.push(shellArg(`${key}=${String(value)}`));
  }
  if (dryRun) parts.push('--dry-run');
  return parts.join(' ');
}

/** `2026-10-24T11:31:45Z` → `24 Oct, 11:31` in the viewer's timezone. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
}
