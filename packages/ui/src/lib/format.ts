/** `⌘` on macOS, `Ctrl` elsewhere. */
export const modLabel: string = /mac/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

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

export function classifyTool(tool: { id: string; title: string; summary: string; tags?: string[] }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [tool.id, tool.title, tool.summary, ...(tool.tags ?? [])].join(' ').toLowerCase();
  return needle.split(/\s+/).every((part) => haystack.includes(part));
}
