import { describe, expect, it } from 'vitest';

import { clampBounds } from './bounds.js';

const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const second = { bounds: { x: 1920, y: 0, width: 1280, height: 1024 } };
const fallback = { x: 100, y: 100, width: 1180, height: 800 };

describe('clampBounds', () => {
  it('keeps a position that is still on a display', () => {
    expect(clampBounds({ x: 200, y: 120, width: 1180, height: 800 }, [display], fallback)).toEqual({
      x: 200,
      y: 120,
      width: 1180,
      height: 800,
    });
  });

  it('keeps a window on the second display', () => {
    expect(clampBounds({ x: 2000, y: 40, width: 1000, height: 700 }, [display, second], fallback)).toEqual({
      x: 2000,
      y: 40,
      width: 1000,
      height: 700,
    });
  });

  it('centres a window whose display is gone', () => {
    const bounds = clampBounds({ x: 5000, y: 40, width: 1180, height: 800 }, [display], fallback);
    expect(bounds.x).toBe(370);
    expect(bounds.y).toBe(140);
  });

  it('never restores a window smaller than the UI works in', () => {
    const bounds = clampBounds({ x: 10, y: 10, width: 200, height: 150 }, [display], fallback);
    expect(bounds.width).toBe(940);
    expect(bounds.height).toBe(620);
  });

  it('fits a window to a smaller display', () => {
    const small = { bounds: { x: 0, y: 0, width: 1024, height: 700 } };
    const bounds = clampBounds({ x: 0, y: 0, width: 1920, height: 1080 }, [small], fallback);
    expect(bounds.width).toBe(1024);
    expect(bounds.height).toBe(700);
  });

  it('falls back when no display is known', () => {
    expect(clampBounds({ x: 5000, y: 40, width: 1180, height: 800 }, [], fallback)).toEqual(fallback);
  });
});
