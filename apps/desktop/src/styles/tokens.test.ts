/**
 * The design system, asserted.
 *
 * A palette drifts quietly and is argued about in review; these numbers are what
 * "readable" means here, so anything below them fails a test instead.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');

const app = read('app.css');
// Comments explain the numbers and may mention a token name next to a colon;
// parsing runs on the declarations only.
const tokens = read('tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of one top-level rule, as written. */
function declarations(selector: string): Map<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from tokens.css`).toBeGreaterThan(-1);
  const end = tokens.indexOf('}', start);
  const body = tokens.slice(start, end);
  const found = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;\n]+);/g)) {
    found.set(match[1] as string, (match[2] as string).trim());
  }
  return found;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((at) => channel(Number.parseInt(value.slice(at, at + 2), 16)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const root = declarations(':root');
const light = new Map([...root, ...declarations("[data-theme='light']")]);

function palette(theme: Map<string, string>, name: string): string {
  const value = theme.get(name);
  if (value === undefined) throw new Error(`${name} is not defined`);
  return value;
}

describe('the type scale', () => {
  it('is a scale, not a set of one-offs', () => {
    const sizes = [...root.entries()]
      .filter(([name, value]) => name.startsWith('--text-') && /^\d+px$/.test(value))
      .map(([, value]) => Number.parseFloat(value.replace('px', '')))
      .sort((a, b) => a - b);
    expect(sizes.length).toBeGreaterThanOrEqual(6);
    expect(sizes.length).toBeLessThanOrEqual(8);
    // Every step is distinct and ascending, and the smallest is still legible.
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(sizes[0]).toBeGreaterThanOrEqual(11);
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(32);
  });
});

describe('app.css uses the vocabulary', () => {
  it('declares no literal font size', () => {
    expect(app).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it('declares no literal radius other than a circle or a square', () => {
    const radii = [...app.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => (match[1] as string).trim());
    expect(radii.length).toBeGreaterThan(10);
    for (const radius of radii) {
      expect(radius, radius).toMatch(/^(var\(--radius-[a-z]+\)|0|50%)$/);
    }
  });

  it('keeps every duration in a token', () => {
    // The reduced-motion override is the one place a literal is allowed, and it
    // is deliberately below 1ms.
    const times = [...app.matchAll(/(\d+(?:\.\d+)?)ms/g)].map((match) => Number(match[1]));
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(time).toBeLessThan(1);
  });
});

describe('density changes geometry, not typography', () => {
  it('touches only measurements', () => {
    for (const name of declarations("[data-density='compact']").keys()) {
      expect(name, name).toMatch(/^--(control-h|control-h-sm|row-pad|table-row-h|list-pad)$/);
    }
  });
});

describe.each([
  ['dark', root],
  ['light', light],
])('contrast in the %s theme', (_theme, theme) => {
  const surfaces = ['--bg', '--surface', '--surface-2', '--surface-3'];

  it('keeps text readable on every surface it sits on', () => {
    for (const name of ['--text', '--text-muted', '--text-faint']) {
      for (const surface of surfaces) {
        const ratio = contrast(palette(theme, name), palette(theme, surface));
        expect(ratio, `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the accent readable as text', () => {
    for (const surface of ['--bg', '--surface']) {
      const ratio = contrast(palette(theme, '--accent'), palette(theme, surface));
      expect(ratio, `--accent on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the verdict colours readable as text', () => {
    for (const name of ['--ok', '--warn', '--error']) {
      for (const surface of ['--bg', '--surface', '--surface-2']) {
        const ratio = contrast(palette(theme, name), palette(theme, surface));
        expect(ratio, `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps accent ink readable on the accent', () => {
    const ratio = contrast(palette(theme, '--accent-ink'), palette(theme, '--accent'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
