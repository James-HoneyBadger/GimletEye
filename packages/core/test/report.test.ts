import { describe, expect, it } from 'vitest';

import { parseOutputFormat, render, sealed, type Report } from '../src/report.js';

const report = (over: Partial<Report> = {}): Report => ({
  tool: 'crypto.sha256',
  status: 'ok',
  summary: 'digest of "hello"',
  duration_ms: 4,
  ...over,
});

describe('the html report', () => {
  it('is a complete document with no way to make a request', () => {
    const html = render(report(), 'html');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('default-src \'none\'');
    expect(html).toContain('<title>crypto.sha256 — Gimlet Eye</title>');
    // Nothing that could run or fetch: a report is a document, not an app.
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\bsrc=/);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('escapes what came out of the file being inspected', () => {
    const hostile = '<script>alert("x")</script>';
    const html = render(
      report({
        summary: hostile,
        findings: [{ severity: 'high', code: 'metadata.gps', message: hostile, target: '<b>a&b</b>' }],
        warnings: [hostile],
      }),
      'html',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;a&amp;b&lt;/b&gt;');
  });

  it('carries the verdict, the findings, and the data', () => {
    const html = render(
      sealed(
        report({
          findings: [
            { severity: 'critical', code: 'crypto.weak', message: 'MD5 in use', target: 'file.txt' },
            { severity: 'low', code: 'crypto.short', message: 'short key' },
          ],
          data: { digest: 'abc123', size: 5 },
        }),
      ),
      'html',
    );
    expect(html).toContain('class="status error"');
    expect(html).toContain('<td>critical</td>');
    expect(html).toContain('<code>crypto.weak</code>');
    expect(html).toContain('file.txt');
    expect(html).toContain('&quot;digest&quot;: &quot;abc123&quot;');
  });

  it('prefers a body the tool formatted over raw data', () => {
    const html = render(report({ body: 'line one\nline two', data: { ignored: true } }), 'html');
    expect(html).toContain('line one');
    expect(html).not.toContain('ignored');
  });
});

describe('output formats', () => {
  it('accepts html and its abbreviation', () => {
    expect(parseOutputFormat('html')).toBe('html');
    expect(parseOutputFormat('HTM')).toBe('html');
  });

  it('still rejects what it never supported', () => {
    expect(() => parseOutputFormat('yaml')).toThrow(/unknown output format/);
  });
});
