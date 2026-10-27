/**
 * The conversation with the verified engine.
 *
 * Every tool is implemented in `packages/engine` now, so this is optional: it
 * is used when one is present, and its absence is a supported state rather than
 * a startup failure. What the engine still buys is an independent implementation
 * of the container format that can be asked for a second opinion — which is why
 * this client survives the port instead of being deleted with the binary.
 */

import { invalidArgs, toolFailed, unsupported } from './errors.js';
import type { EngineTransport, Host } from './host.js';
import type { ToolManifest } from './manifest.js';
import type { Args } from './args.js';
import type { Report } from './report.js';

/** The protocol this client speaks; the engine refuses anything else. */
export const ENGINE_PROTOCOL_VERSION = 1;

export interface Handshake {
  protocol_version: number;
  version: string;
}

export class Sidecar {
  private tools: ToolManifest[] | null = null;

  private constructor(
    private readonly transport: EngineTransport | null,
    readonly version: string,
    /** Why there is no engine, when there is none. */
    private readonly problem = '',
  ) {}

  /** A runtime with no engine: local tools work, and anything that needed the
   * engine says which part is missing instead of claiming the tool is unknown. */
  static unavailable(reason: string): Sidecar {
    return new Sidecar(null, 'none', reason);
  }

  get available(): boolean {
    return this.transport !== null;
  }

  static async open(host: Host): Promise<Sidecar> {
    const transport = await host.engine();
    const reply = (await transport.request({ op: 'handshake' })) as {
      protocol_version?: number;
      version?: string;
    };
    const protocol = reply.protocol_version;
    if (typeof protocol !== 'number' || protocol !== ENGINE_PROTOCOL_VERSION) {
      transport.close();
      throw unsupported(
        `the engine speaks protocol ${protocol ?? 'unknown'}; this build speaks ${ENGINE_PROTOCOL_VERSION}. Rebuild both.`,
      );
    }
    return new Sidecar(transport, reply.version ?? 'unknown');
  }

  /** Every tool the engine offers. Cached: the catalogue cannot change while it runs. */
  async list(): Promise<ToolManifest[]> {
    if (!this.available) return [];
    if (this.tools) return this.tools;
    const reply = (await this.transport!.request({ op: 'list' })) as { tools?: ToolManifest[] };
    if (!Array.isArray(reply.tools)) {
      throw toolFailed('the engine answered a list request without a tool list');
    }
    this.tools = reply.tools;
    return this.tools;
  }

  async run(tool: string, args: Args, options: { dryRun: boolean; home: string }): Promise<Report> {
    const transport = this.transport;
    if (transport === null) {
      throw toolFailed(`'${tool}' is not built into this install, and there is no engine to run it: ${this.problem}`);
    }
    const reply = (await transport.request({
      op: 'run',
      tool,
      args,
      dry_run: options.dryRun,
      home: options.home,
    })) as { report?: Report };
    if (!reply.report) throw toolFailed(`the engine returned no report for '${tool}'`);
    return assertReport(reply.report, tool);
  }

  close(): void {
    this.transport?.close();
  }
}

/** Reject an engine reply that is not shaped like a tool run, before it reaches a renderer. */
export function assertReport(value: unknown, tool: string): Report {
  if (typeof value !== 'object' || value === null) throw invalidArgs(`malformed report for '${tool}'`);
  const report = value as Partial<Report>;
  if (typeof report.status !== 'string' || typeof report.summary !== 'string') {
    throw invalidArgs(`malformed report for '${tool}'`);
  }
  return report as Report;
}
