/**
 * Path arithmetic without a runtime.
 *
 * The desktop app runs in a webview, where `node:path` does not exist and
 * IPC is async; resolving a config root should not be. These are
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

/**
 * A sibling temporary name that another process cannot collide with.
 *
 * `${path}.tmp` looks convenient and is a lost-update bug: the CLI and the open
 * desktop writing the keystore would share the name, and the second rename would
 * publish a file built from a store the first never saw. The stamp makes each
 * writer's temporary private; the rename is still what publishes it.
 *
 * The random half comes from the platform CSPRNG (`globalThis.crypto`, which
 * Node 20 and every browser bundle here provide) rather than `Math.random()`: a
 * predictable temporary name in a shared directory is a symlink an attacker can
 * aim at a file of their choosing.
 */
export function tempName(path: string): string {
  const random = new Uint8Array(8);
  globalThis.crypto.getRandomValues(random);
  const stamp = [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${path}.${Date.now().toString(36)}-${stamp}.tmp`;
}
