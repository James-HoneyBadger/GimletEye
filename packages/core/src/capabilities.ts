/**
 * A Host that refuses what the manifest did not declare.
 *
 * Capabilities were a declaration nothing checked: `fs:write` and
 * `process:exec` told a reader what a tool could do, not what it was allowed to
 * do. The runtime now hands each built-in tool a guarded Host, so a write from a
 * tool that did not declare `fs:write` fails with `capability_denied` instead of
 * succeeding quietly.
 *
 * What is enforced is the pair that can damage a machine: filesystem writes and
 * subprocesses. Reads are not gated — they cannot destroy anything, and `system`
 * is the capability that describes host inspection. `secrets` is not observable
 * through `Host`; key material stays inside the engine's own functions. The
 * sidebar rule follows from that: `network` has no `Host` method at all, so it
 * has nothing to enforce.
 *
 * The optional engine runs in its own process and is not wrapped; its report is
 * checked at the boundary instead.
 */

import { GimletError } from './errors.js';
import type { Capability, ToolManifest } from './manifest.js';
import type { Host } from './host.js';

/** The `Host` members that write, and the capability they need. */
const WRITE_CAPABILITY = 'fs:write' as const;
const EXEC_CAPABILITY = 'process:exec' as const;

export function guardedHost(host: Host, manifest: ToolManifest): Host {
  const declared = new Set<Capability>(manifest.capabilities ?? []);
  const writes = declared.has(WRITE_CAPABILITY);
  const execs = declared.has(EXEC_CAPABILITY);
  // Nothing to guard, and no wrapper to pay for.
  if (writes && execs) return host;

  const denied = (capability: Capability, what: string): Promise<never> =>
    Promise.reject(
      new GimletError(
        'capability_denied',
        `'${manifest.id}' used ${what} without declaring ${capability}`,
      ),
    );

  const guard =
    <A extends unknown[], R>(
      allowed: boolean,
      capability: Capability,
      what: string,
      operation: (...args: A) => Promise<R>,
    ) =>
    (...args: A): Promise<R> =>
      allowed ? operation(...args) : denied(capability, what);

  return {
    ...host,
    writeTextFile: guard(writes, WRITE_CAPABILITY, 'a file write', (path: string, text: string) =>
      host.writeTextFile(path, text),
    ),
    writeFile: guard(writes, WRITE_CAPABILITY, 'a file write', (path: string, bytes: Uint8Array) =>
      host.writeFile(path, bytes),
    ),
    writeFileMode: guard(
      writes,
      WRITE_CAPABILITY,
      'a file write',
      (path: string, bytes: Uint8Array, mode: number) => host.writeFileMode(path, bytes, mode),
    ),
    appendTextFile: guard(writes, WRITE_CAPABILITY, 'a file append', (path: string, text: string) =>
      host.appendTextFile(path, text),
    ),
    appendFile: guard(writes, WRITE_CAPABILITY, 'a file append', (path: string, bytes: Uint8Array) =>
      host.appendFile(path, bytes),
    ),
    createDir: guard(writes, WRITE_CAPABILITY, 'a directory create', (path: string) =>
      host.createDir(path),
    ),
    removeTree: guard(writes, WRITE_CAPABILITY, 'a removal', (path: string) => host.removeTree(path)),
    rename: guard(writes, WRITE_CAPABILITY, 'a rename', (from: string, to: string) =>
      host.rename(from, to),
    ),
    chmod: guard(writes, WRITE_CAPABILITY, 'a permission change', (path: string, bits: number) =>
      host.chmod(path, bits),
    ),
    chmodOwnerOnly: guard(writes, WRITE_CAPABILITY, 'a permission change', (path: string) =>
      host.chmodOwnerOnly(path),
    ),
    exec: guard(execs, EXEC_CAPABILITY, 'a subprocess', (program: string, args: readonly string[]) =>
      host.exec(program, args),
    ),
  };
}
