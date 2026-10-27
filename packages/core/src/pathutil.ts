/**
 * Path arithmetic without a runtime.
 *
 * The desktop app runs in a webview, where `node:path` does not exist and
 * Tauri's path plugin is async; resolving a config root should not be. These are
 * the four operations the toolkit actually needs, written once so the CLI and
 * the webview agree on what `join(root, 'audit.jsonl')` means.
 */

const sep = '/';

/** True when `path` names an absolute location on either platform. */
export function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

export function join(...parts: string[]): string {
  const kept = parts.filter((part) => part !== '' && part !== '.');
  if (kept.length === 0) return '.';
  let out = kept[0]!.replaceAll('\\', sep);
  for (const part of kept.slice(1)) {
    const next = part.replaceAll('\\', sep);
    out = out.endsWith(sep) ? out + next.replace(/^\/+/, '') : `${out}/${next.replace(/^\/+/, '')}`;
  }
  return normalize(out);
}

export function normalize(path: string): string {
  const unix = path.replaceAll('\\', sep);
  const absolute = unix.startsWith('/');
  const pieces: string[] = [];
  for (const piece of unix.split('/')) {
    if (piece === '' || piece === '.') continue;
    if (piece === '..') {
      // Above the root is the root, which is what every shell does.
      if (pieces.length > 0 && pieces[pieces.length - 1] !== '..') pieces.pop();
      else if (!absolute) pieces.push('..');
      continue;
    }
    pieces.push(piece);
  }
  const body = pieces.join('/');
  return absolute ? `/${body}` : body === '' ? '.' : body;
}

export function dirname(path: string): string {
  const clean = normalize(path);
  const at = clean.lastIndexOf('/');
  if (at < 0) return '.';
  if (at === 0) return '/';
  return clean.slice(0, at);
}

export function basename(path: string): string {
  const clean = normalize(path);
  const at = clean.lastIndexOf('/');
  return at < 0 ? clean : clean.slice(at + 1);
}

export function extension(path: string): string {
  const name = basename(path);
  const at = name.lastIndexOf('.');
  return at <= 0 ? '' : name.slice(at + 1);
}

export function stem(path: string): string {
  const name = basename(path);
  const at = name.lastIndexOf('.');
  return at <= 0 ? name : name.slice(0, at);
}
