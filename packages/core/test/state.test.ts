import { describe, expect, it } from 'vitest';

import { AuditLog, auditEntry } from '../src/audit.js';
import { configToToml, defaultConfig, loadConfig, moduleSetting, parseConfig } from '../src/config.js';
import { discoverPaths, keystorePath, pathsUnder } from '../src/paths.js';
import { fakeHost } from './fake-host.js';

describe('configuration', () => {
  it('defaults are usable and round-trip through toml', () => {
    const config = defaultConfig();
    const reparsed = parseConfig(configToToml(config));
    expect(reparsed.defaults.output).toBe('text');
    expect(reparsed.audit.enabled).toBe(true);
    expect(reparsed.audit.max_entries).toBe(1000);
  });

  it('fills defaults for a partial file', () => {
    const config = parseConfig(`
schema_version = 1

[defaults]
output = "json"

[modules.sysadmin]
warn_load_percent = 90
`);
    expect(config.defaults.output).toBe('json');
    expect(config.audit.enabled).toBe(true);
    expect(moduleSetting(config, 'sysadmin', 'warn_load_percent', 0)).toBe(90);
  });

  it('refuses a file from a newer build', () => {
    expect(() => parseConfig('schema_version = 99')).toThrow(/newer than supported/);
  });

  it('ignores sections belonging to surfaces that no longer exist', () => {
    // `[plugins]` and `[api]` shipped in earlier releases; failing on them would
    // punish a user for upgrading.
    const config = parseConfig(`
schema_version = 1

[plugins]
timeout_ms = 1000

[api]
require_token = false
`);
    expect(config.schema_version).toBe(1);
  });

  it('reads a config file only when it exists', async () => {
    const host = fakeHost();
    host.files.set('/tmp/home/config.toml', '[defaults]\noutput = "markdown"\n');
    const config = await loadConfig(pathsUnder('/tmp/home'), host);
    expect(config.defaults.output).toBe('markdown');

    const missing = await loadConfig(pathsUnder('/tmp/absent'), host);
    expect(missing.defaults.output).toBe('text');
  });
});

describe('paths', () => {
  it('uses GIMLET_HOME above everything else', async () => {
    const host = fakeHost();
    const paths = await discoverPaths(host, '/tmp/explicit');
    expect(paths.root).toBe('/tmp/explicit');
  });

  it('keeps using a pre-rename home when the new one does not exist', async () => {
    const host = fakeHost();
    host.dirs.add('/home/tester/.config/mellivora');
    const paths = await discoverPaths(host);
    expect(paths.root).toBe('/home/tester/.config/mellivora');
  });

  it('prefers the new home once it exists', async () => {
    const host = fakeHost();
    host.dirs.add('/home/tester/.config/mellivora');
    host.dirs.add('/home/tester/.config/gimlet');
    const paths = await discoverPaths(host);
    expect(paths.root).toBe('/home/tester/.config/gimlet');
  });

  it('reads a keystore sealed before the rename', async () => {
    const host = fakeHost();
    host.files.set('/tmp/home/keystore.melv', 'sealed');
    expect(await keystorePath(pathsUnder('/tmp/home'), host)).toBe('/tmp/home/keystore.melv');

    host.files.set('/tmp/home/keystore.gimlet', 'sealed');
    expect(await keystorePath(pathsUnder('/tmp/home'), host)).toBe('/tmp/home/keystore.gimlet');
  });
});

describe('audit trail', () => {
  it('records names, never values, and trims to the cap', async () => {
    const host = fakeHost();
    const log = new AuditLog(host, '/tmp/home/audit.jsonl', 2);

    await log.record(auditEntry('a.b', 'ok', 1, ['input', 'passphrase_env']));
    await log.record(auditEntry('a.b', 'warning', 2, ['input']));
    await log.record(auditEntry('a.b', 'error', 3, []));

    const tail = await log.tail(10);
    expect(tail).toHaveLength(2);
    expect(tail[0]?.status).toBe('error');
    const raw = host.files.get('/tmp/home/audit.jsonl') ?? '';
    expect(raw).not.toContain('correct-horse');
    expect(raw.trim().split('\n')).toHaveLength(2);
  });

  it('skips a malformed line instead of losing the trail', async () => {
    const host = fakeHost();
    host.files.set('/tmp/home/audit.jsonl', `${JSON.stringify(auditEntry('a.b', 'ok', 1))}\nnot json\n`);
    const log = new AuditLog(host, '/tmp/home/audit.jsonl', 10);
    expect(await log.readAll()).toHaveLength(1);
  });
});
