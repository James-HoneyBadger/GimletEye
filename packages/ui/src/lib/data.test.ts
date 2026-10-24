import { describe, expect, it } from 'vitest';

import { renderData } from './data';

describe('renderData', () => {
  it('escapes markup from tool output', () => {
    const html = renderData({ hostname: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders arrays of objects as a table', () => {
    const html = renderData([
      { path: '/', used: 10 },
      { path: '/home', used: 3 },
    ]);
    expect(html).toContain('<table');
    expect(html).toContain('/home');
  });

  it('renders nested objects as sections', () => {
    const html = renderData({ host: 'example', disk: { total: 10, free: 4 } });
    expect(html).toContain('data-section');
    expect(html).toContain('Disk');
  });

  it('says when columns were dropped, even if only a later row is wide', () => {
    const narrow = { a: 1 };
    const wide = Object.fromEntries('abcdefghi'.split('').map((key, index) => [key, index]));
    expect(renderData([narrow, wide])).toContain('Showing the first 8 columns');
    expect(renderData([narrow])).not.toContain('Showing the first');
  });

  it('explains missing data instead of rendering an empty shell', () => {
    expect(renderData(null)).toContain('No structured data');
    expect(renderData([])).toContain('Empty list');
  });
});
