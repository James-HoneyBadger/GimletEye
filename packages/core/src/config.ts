/**
 * One configuration file for both surfaces.
 *
 * Modules own their own namespaced keys under `[modules.<namespace>]`, so adding
 * a tool never means editing this file. A config written by a newer build is
 * refused rather than half-understood; a config written by an older one — which
 * may still carry sections for surfaces that no longer exist — loads, because
 * failing on the user's behalf is not helpful.
 */

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { config as configError } from './errors.js';
import { dirname } from './pathutil.js';
import { parseOutputFormat, type OutputFormat } from './report.js';
import type { AppPaths } from './paths.js';
import type { Host } from './host.js';

export const CONFIG_SCHEMA_VERSION = 1;

export interface Defaults {
  output: OutputFormat;
  dry_run: boolean;
}

export interface AuditSettings {
  enabled: boolean;
  /** Overrides the default `<root>/audit.jsonl`. */
  path?: string;
  max_entries: number;
}

export interface Config {
  schema_version: number;
  defaults: Defaults;
  audit: AuditSettings;
  modules: Record<string, unknown>;
}

export function defaultConfig(): Config {
  return {
    schema_version: CONFIG_SCHEMA_VERSION,
    defaults: { output: 'text', dry_run: false },
    audit: { enabled: true, max_entries: 1000 },
    modules: {},
  };
}

export async function loadConfig(paths: AppPaths, host: Host): Promise<Config> {
  if (!(await host.exists(paths.configFile))) return defaultConfig();
  return parseConfig(await host.readTextFile(paths.configFile));
}

export function parseConfig(raw: string): Config {
  let document: Record<string, unknown>;
  try {
    document = parseToml(raw) as Record<string, unknown>;
  } catch (error) {
    throw configError(`${error instanceof Error ? error.message : String(error)}`);
  }

  const base = defaultConfig();
  const schema = numberOr(document['schema_version'], base.schema_version);
  if (schema > CONFIG_SCHEMA_VERSION) {
    throw configError(`config schema ${schema} is newer than supported schema ${CONFIG_SCHEMA_VERSION}`);
  }

  const defaults = objectOr(document['defaults'], {});
  const audit = objectOr(document['audit'], {});
  const modules = objectOr(document['modules'], {});

  const output = stringOr(defaults['output']);
  return {
    schema_version: schema,
    defaults: {
      output: output === undefined ? base.defaults.output : safeFormat(output),
      dry_run: booleanOr(defaults['dry_run'], base.defaults.dry_run),
    },
    audit: {
      enabled: booleanOr(audit['enabled'], base.audit.enabled),
      ...(stringOr(audit['path']) === undefined ? {} : { path: stringOr(audit['path'])! }),
      max_entries: numberOr(audit['max_entries'], base.audit.max_entries),
    },
    modules,
  };
}

export function configToToml(config: Config): string {
  return stringifyToml({
    schema_version: config.schema_version,
    defaults: { output: config.defaults.output, dry_run: config.defaults.dry_run },
    audit: {
      enabled: config.audit.enabled,
      ...(config.audit.path === undefined ? {} : { path: config.audit.path }),
      max_entries: config.audit.max_entries,
    },
    ...(Object.keys(config.modules).length === 0 ? {} : { modules: config.modules }),
  });
}

export async function saveConfig(config: Config, path: string, host: Host): Promise<void> {
  await host.createDir(dirname(path));
  await host.writeTextFile(path, configToToml(config));
}

/** Read a module namespace without knowing what lives in it. */
export function moduleSetting<T>(config: Config, namespace: string, key: string, fallback: T): T {
  const module = config.modules[namespace];
  if (typeof module !== 'object' || module === null) return fallback;
  const value = (module as Record<string, unknown>)[key];
  return (value === undefined || value === null ? fallback : (value as T));
}

function objectOr(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fallback;
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function safeFormat(value: string): OutputFormat {
  try {
    return parseOutputFormat(value);
  } catch {
    throw configError(`unknown output format '${value}'`);
  }
}
