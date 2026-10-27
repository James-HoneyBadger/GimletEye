/**
 * The catalogue a surface resolves against.
 *
 * Resolution is one implementation, used by the CLI and by the desktop's search
 * alike: exact id, then a case-insensitive spelling, then a unique suffix such
 * as `system-info` for `sysadmin.system-info`. An ambiguous suffix resolves to
 * nothing rather than to a guess.
 */

import { config as configError, internal } from './errors.js';
import { platformAllows, type Category, type Platform, type ToolManifest } from './manifest.js';

export class Registry {
  private readonly byId = new Map<string, ToolManifest>();

  register(manifest: ToolManifest): void {
    if (manifest.id === '') throw internal('tool registered with an empty id');
    if (this.byId.has(manifest.id)) throw configError(`duplicate tool id '${manifest.id}'`);
    // Two sources produce manifests — TypeScript tools and the engine — and the
    // engine omits empty lists. Fill them once here so a consumer never has to
    // distinguish "absent" from "empty".
    this.byId.set(manifest.id, {
      ...manifest,
      capabilities: manifest.capabilities ?? [],
      args: manifest.args ?? [],
      tags: manifest.tags ?? [],
      platforms: manifest.platforms ?? [],
      mutates: manifest.mutates ?? false,
    });
  }

  registerAll(manifests: readonly ToolManifest[]): void {
    for (const manifest of manifests) this.register(manifest);
  }

  get(id: string): ToolManifest | undefined {
    return this.byId.get(id);
  }

  resolve(query: string): ToolManifest | undefined {
    const trimmed = query.trim();
    if (trimmed === '') return undefined;

    const exact = this.byId.get(trimmed);
    if (exact) return exact;

    const normalized = trimmed.replaceAll('_', '-').toLowerCase();
    for (const [id, manifest] of this.byId) {
      if (id.toLowerCase() === normalized) return manifest;
    }

    const suffix = `.${normalized}`;
    const matches = [...this.byId.entries()]
      .filter(([id]) => id.toLowerCase().endsWith(suffix))
      .map(([, manifest]) => manifest);
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** Ids close enough to `query` to be worth suggesting, best first. */
  suggest(query: string, limit: number): string[] {
    const scored: { score: number; id: string }[] = [];
    for (const id of this.byId.keys()) {
      const tail = id.includes('.') ? id.slice(id.lastIndexOf('.') + 1) : id;
      const score = Math.max(similarity(query, id), similarity(query, tail));
      if (score >= 0.34) scored.push({ score, id });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((entry) => entry.id);
  }

  /** Every manifest this platform can run, sorted by id. */
  runnable(platform: Platform): ToolManifest[] {
    return this.list().filter((manifest) => platformAllows(manifest, platform));
  }

  list(): ToolManifest[] {
    return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  inCategory(category: Category): ToolManifest[] {
    return this.list().filter((manifest) => manifest.category === category);
  }

  categories(): Category[] {
    return [...new Set(this.list().map((manifest) => manifest.category))].sort();
  }

  get size(): number {
    return this.byId.size;
  }
}

/** Sørensen–Dice over trigrams, which is what the CLI's "did you mean" uses. */
export function similarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return left.toLowerCase() === right.toLowerCase() ? 1 : 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  const union = a.size + b.size - intersection;
  return intersection / union;
}

function trigrams(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .join(' ');
  if (normalized.length < 3) return new Set([normalized]);
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}
