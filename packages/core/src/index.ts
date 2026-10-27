/**
 * One contract for both surfaces.
 *
 * The CLI and the desktop app import this package and nothing else: the tool
 * catalogue, the report shape, the configuration, the audit trail, and the
 * conversation with the verified engine all live here.
 *
 * The Node host is a second entry point (`@gimlet-eye/core/host-node`) rather
 * than an export of this barrel: a webview bundle must not contain `node:fs`,
 * and pulling it in breaks the desktop build.
 */

export * from './version.js';
export * from './errors.js';
export * from './pathutil.js';
export * from './report.js';
export * from './manifest.js';
export * from './args.js';
export * from './host.js';
export * from './paths.js';
export * from './config.js';
export * from './audit.js';
export * from './registry.js';
export * from './sidecar.js';
export * from './local.js';
export * from './runtime.js';
export * from './tools/system-info.js';
export * from './tools/disk-usage.js';
export * from './tools/kernel-hardening.js';
export * from './tools/network.js';
