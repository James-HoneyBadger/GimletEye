/**
 * What a tool declares about itself.
 *
 * The shape is the wire schema: the sidecar sends it when a surface asks what
 * the engine can do, and both surfaces build their forms and listings from it,
 * so a new engine tool needs no frontend change.
 */

export const CATEGORIES = [
  'sysadmin',
  'crypto',
  'privacy',
  'forensics',
  'automation',
  'developer',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Operating systems a manifest may name. */
export type Platform = 'linux' | 'macos' | 'windows';

export const CAPABILITIES = [
  'fs:read',
  'fs:write',
  'process:exec',
  'network',
  'secrets',
  'system',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface EnumArgSpec {
  name: string;
  type: 'enum';
  values: string[];
  required?: boolean;
  default?: unknown;
  help?: string;
}

export interface ScalarArgSpec {
  name: string;
  type: 'string' | 'integer' | 'boolean' | 'path';
  required?: boolean;
  default?: unknown;
  help?: string;
}

export type ArgSpec = EnumArgSpec | ScalarArgSpec;

export interface ToolManifest {
  id: string;
  title: string;
  summary: string;
  category: Category;
  capabilities?: Capability[];
  args?: ArgSpec[];
  tags?: string[];
  /** The tool can write to this machine. Surfaces offer a dry run only here. */
  mutates?: boolean;
  /** Operating systems the tool supports; empty or absent means everywhere. */
  platforms?: string[];
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** Parse a category name the way the CLI accepts it (`system` means `sysadmin`). */
export function parseCategory(value: string): Category {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'system') return 'sysadmin';
  if (normalized === 'dev') return 'developer';
  if (isCategory(normalized)) return normalized;
  throw new Error(`unknown category '${value}'`);
}

/**
 * A tool that declares platforms only runs on those. The caller supplies the
 * platform, because a webview has no `process` to ask.
 */
export function platformAllows(manifest: ToolManifest, platform: Platform): boolean {
  const declared = manifest.platforms ?? [];
  return declared.length === 0 || declared.includes(platform);
}
