/**
 * The window is a local document with no way out.
 *
 * The session cancels non-local requests and the e2e run proves a run makes
 * none; this checks the other half — that the document itself declares a policy
 * allowing nothing remote, so a future inline script or remote asset fails
 * before it is written rather than after.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function policy(): string {
  const match = /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/.exec(html);
  if (match === null) throw new Error('index.html declares no Content-Security-Policy');
  return match[1] as string;
}

describe('the window document', () => {
  it('allows nothing by default', () => {
    expect(policy()).toMatch(/^default-src 'none'/);
  });

  it('allows no eval, no remote script, and no frame', () => {
    const declared = policy();
    expect(declared).toContain("script-src 'self'");
    expect(declared).toContain("base-uri 'none'");
    expect(declared).toContain("form-action 'none'");
    expect(declared).toContain("object-src 'none'");
    expect(declared).not.toContain('unsafe-eval');
    expect(declared).not.toMatch(/https?:/);
  });
});
