/**
 * The composition root: paths, config, audit, registry, and the engine.
 *
 * Both surfaces go through this. `run` is the only way a tool is executed, which
 * is what keeps the audit trail complete — a surface cannot remember to record a
 * run it did not make here.
 */

import { AuditLog, auditEntry } from './audit.js';
import { loadConfig, type Config } from './config.js';
import { GimletError, asGimletError, notFound } from './errors.js';
import { diskUsage } from './tools/disk-usage.js';
import { sha256 } from './tools/hash.js';
import { kernelHardening } from './tools/kernel-hardening.js';
import { metadataScan, metadataVerify } from './tools/metadata.js';
import { network } from './tools/network.js';
import { passgen } from './tools/passwords.js';
import { systemInfo } from './tools/system-info.js';
import { discoverPaths, ensurePaths, type AppPaths } from './paths.js';
import { Registry } from './registry.js';
import { Sidecar } from './sidecar.js';
import type { Args } from './args.js';
import type { Host } from './host.js';
import type { LocalTool } from './local.js';
import { platformAllows } from './manifest.js';
import type { Report } from './report.js';

export interface RunOptions {
  dryRun?: boolean;
}

export interface RunResult {
  tool: string;
  report: Report;
}

export interface RuntimeOptions {
  /** Overrides `GIMLET_HOME`; the CLI's `--home`. */
  home?: string | undefined;
  dryRun?: boolean | undefined;
}

export class Runtime {
  private constructor(
    readonly host: Host,
    readonly paths: AppPaths,
    readonly config: Config,
    readonly audit: AuditLog,
    readonly registry: Registry,
    readonly engineVersion: string,
    private readonly local: Map<string, LocalTool>,
    private readonly sidecar: Sidecar,
    private readonly dryRun: boolean,
  ) {}

  static async load(host: Host, options: RuntimeOptions = {}): Promise<Runtime> {
    const paths = await discoverPaths(host, options.home);
    await ensurePaths(paths, host);
    const config = await loadConfig(paths, host);

    const registry = new Registry();
    const local = new Map<string, LocalTool>();
    for (const tool of [systemInfo, diskUsage, kernelHardening, network, sha256, passgen, metadataScan, metadataVerify]) {
      local.set(tool.manifest.id, tool);
      registry.register(tool.manifest);
    }

    const sidecar = await Sidecar.open(host);
    for (const manifest of await sidecar.list()) {
      if (!registry.get(manifest.id)) registry.register(manifest);
    }

    const auditPath = config.audit.path ?? paths.auditFile;
    const audit = new AuditLog(host, auditPath, config.audit.max_entries);

    return new Runtime(
      host,
      paths,
      config,
      audit,
      registry,
      sidecar.version,
      local,
      sidecar,
      options.dryRun ?? config.defaults.dry_run,
    );
  }

  /** Resolve a query the way a surface would, with the CLI's error text. */
  require(query: string) {
    const manifest = this.registry.resolve(query);
    if (manifest) return manifest;
    const suggestions = this.registry.suggest(query, 3);
    const hint =
      suggestions.length === 0
        ? ''
        : suggestions.length === 1
          ? ` Did you mean '${suggestions[0]}'?`
          : ` Did you mean one of: ${suggestions.join(', ')}?`;
    throw notFound(`tool '${query}'.${hint} Run \`gimlet tools list\` to see everything available.`);
  }

  /**
   * Run one tool and record it.
   *
   * A run that fails is recorded too, with the same argument *names* and no
   * values, because repeated failures are exactly what a trail is for.
   */
  async run(query: string, args: Args, options: RunOptions = {}): Promise<RunResult> {
    const manifest = this.require(query);
    const dryRun = options.dryRun ?? this.dryRun;
    const started = Date.now();
    const argKeys = Object.keys(args).sort();

    try {
      const report = await this.execute(manifest.id, args, dryRun);
      await this.record(manifest.id, report.status, Date.now() - started, argKeys);
      return { tool: manifest.id, report };
    } catch (error) {
      const failure = asGimletError(error);
      await this.record(manifest.id, 'error', Date.now() - started, argKeys);
      throw failure;
    }
  }

  private async execute(id: string, args: Args, dryRun: boolean): Promise<Report> {
    // One gate for every surface: a tool that declares platforms is refused
    // here rather than in each dispatch path.
    const manifest = this.registry.get(id);
    if (manifest && !platformAllows(manifest, this.host.platform)) {
      throw new GimletError(
        'unsupported',
        `unsupported operation: ${id} supports ${(manifest.platforms ?? []).join(', ')}; this host is ${this.host.platform}`,
      );
    }
    const local = this.local.get(id);
    if (local) {
      return local.run({ host: this.host, config: this.config, dryRun }, args);
    }
    return this.sidecar.run(id, args, { dryRun, home: this.paths.root });
  }

  private async record(tool: string, status: Report['status'], durationMs: number, argKeys: string[]): Promise<void> {
    if (!this.config.audit.enabled) return;
    try {
      await this.audit.record(auditEntry(tool, status, durationMs, argKeys));
    } catch (error) {
      // A trail that cannot be written must not fail the run that succeeded, but
      // it must be visible.
      console.error(`gimlet: could not write the audit trail: ${asGimletError(error).message}`);
    }
  }

  async auditTail(limit: number) {
    return this.audit.tail(limit);
  }

  close(): void {
    this.sidecar.close();
  }
}

export { GimletError };
