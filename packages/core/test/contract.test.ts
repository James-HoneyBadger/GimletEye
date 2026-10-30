import { describe, expect, it } from 'vitest';

import { coerce, fromPairs, isSecretArg } from '../src/args.js';
import { render, sealed, type Report } from '../src/report.js';
import { Registry, similarity } from '../src/registry.js';
import { platformAllows, type ToolManifest } from '../src/manifest.js';

const manifest = (id: string, category: ToolManifest['category'] = 'sysadmin'): ToolManifest => ({
  id,
  title: id,
  summary: `about ${id}`,
  category,
});

describe('argument parsing', () => {
  it('types only what survives a round trip', () => {
    expect(coerce('true')).toBe(true);
    expect(coerce('false')).toBe(false);
    expect(coerce('32')).toBe(32);
    expect(coerce('-5')).toBe(-5);
    // A passphrase or a PIN that looks numeric must not be rewritten.
    expect(coerce('0123')).toBe('0123');
    expect(coerce('+5')).toBe('+5');
    expect(coerce('-0')).toBe('-0');
    expect(coerce('')).toBe('');
  });

  it('rejects a bare word instead of guessing', () => {
    expect(() => fromPairs(['nope'])).toThrow(/must be key=value/);
  });

  it('keeps later duplicates, as a shell would', () => {
    expect(fromPairs(['a=1', 'a=2'])).toEqual({ a: 2 });
  });

  it('recognises the names a surface must mask', () => {
    for (const name of ['passphrase', 'new_passphrase', 'password', 'secret', 'secret_key', 'token', 'pin']) {
      expect(isSecretArg(name), name).toBe(true);
    }
    for (const name of ['key', 'input', 'public_key', 'pinned_version']) {
      expect(isSecretArg(name), name).toBe(false);
    }
    // An argument that names an environment variable holds a name, not a value:
    // redacting it would break the command it appears in.
    for (const name of ['passphrase_env', 'new_passphrase_env', 'password_env']) {
      expect(isSecretArg(name), name).toBe(false);
    }
  });
});

describe('report verdicts', () => {
  const base: Report = { tool: 'demo', status: 'ok', summary: '', duration_ms: 1 };

  it('derives the verdict from the findings', () => {
    expect(sealed({ ...base, findings: [{ severity: 'info', code: 'i', message: '' }] }).status).toBe('ok');
    expect(sealed({ ...base, findings: [{ severity: 'medium', code: 'm', message: '' }] }).status).toBe('warning');
    expect(sealed({ ...base, findings: [{ severity: 'high', code: 'h', message: '' }] }).status).toBe('error');
  });

  it('renders findings with their target in text', () => {
    const text = render(
      sealed({ ...base, findings: [{ severity: 'high', code: 'x', message: 'boom', target: '/tmp' }] }),
      'text',
    );
    expect(text).toContain('✖ demo');
    expect(text).toContain('[high    ] x: boom  (/tmp)');
  });

  it('renders an array of objects as a csv table', () => {
    const csv = render({ ...base, data: [{ mount: '/', use_percent: 10 }] }, 'csv');
    expect(csv.split('\n')[0]).toBe('mount,use_percent');
    expect(csv).toContain('/,10');
  });

  it('escapes commas and quotes in csv', () => {
    const csv = render({ ...base, data: { note: 'a,b"c' } }, 'csv');
    expect(csv).toContain('"a,b""c"');
  });
});

describe('platform declarations', () => {
  const base: ToolManifest = { id: 'a.b', title: 'A', summary: 'a', category: 'sysadmin' };

  it('treats an empty list as everywhere', () => {
    expect(platformAllows({ ...base, platforms: [] }, 'linux')).toBe(true);
    expect(platformAllows(base, 'macos')).toBe(true);
  });

  it('refuses a host the manifest does not name', () => {
    expect(platformAllows({ ...base, platforms: ['linux'] }, 'linux')).toBe(true);
    expect(platformAllows({ ...base, platforms: ['linux'] }, 'macos')).toBe(false);
  });
});

describe('registry resolution', () => {
  const registry = new Registry();
  registry.register(manifest('sysadmin.system-info'));
  registry.register(manifest('privacy.metadata-scan', 'privacy'));

  it('resolves an exact id, a case variant, and a unique suffix', () => {
    expect(registry.resolve('sysadmin.system-info')?.id).toBe('sysadmin.system-info');
    expect(registry.resolve('SYSTEM-INFO')?.id).toBe('sysadmin.system-info');
    expect(registry.resolve('system_info')?.id).toBe('sysadmin.system-info');
  });

  it('refuses to guess between two matches', () => {
    const ambiguous = new Registry();
    ambiguous.register(manifest('a.thing'));
    ambiguous.register(manifest('b.thing'));
    expect(ambiguous.resolve('thing')).toBeUndefined();
  });

  it('suggests a near miss', () => {
    expect(registry.suggest('systeminf', 3)).toContain('sysadmin.system-info');
    expect(similarity('system-info', 'system-info')).toBe(1);
  });

  it('rejects a duplicate id rather than replacing a tool', () => {
    const duplicate = new Registry();
    duplicate.register(manifest('a.b'));
    expect(() => duplicate.register(manifest('a.b'))).toThrow(/duplicate/);
  });
});
