/**
 * The conversation with the verified engine.
 *
 * Crypto and metadata parsing live in `gimlet-sidecar`: they carry the fuzz
 * corpora, the golden fixtures, and the second implementation that pins the
 * container format. This client is the only place that knows the wire format, so
 * a change to it is one file in one language rather than one per surface.
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
    private readonly transport: EngineTransport,
    readonly version: string,
  ) {}

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
    if (this.tools) return this.tools;
    const reply = (await this.transport.request({ op: 'list' })) as { tools?: ToolManifest[] };
    if (!Array.isArray(reply.tools)) {
      throw toolFailed('the engine answered a list request without a tool list');
    }
    this.tools = reply.tools;
    return this.tools;
  }

  async run(tool: string, args: Args, options: { dryRun: boolean; home: string }): Promise<Report> {
    const reply = (await this.transport.request({
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
    this.transport.close();
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
