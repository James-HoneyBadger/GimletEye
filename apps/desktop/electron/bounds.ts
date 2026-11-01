export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  bounds: Bounds;
}

const MIN_WIDTH = 940;
const MIN_HEIGHT = 620;
/** How much of the window has to be on a display for it to count as visible. */
const VISIBLE = 48;

function intersects(window: Bounds, display: Bounds): boolean {
  const width = Math.min(window.x + window.width, display.x + display.width) - Math.max(window.x, display.x);
  const height = Math.min(window.y + window.height, display.y + display.height) - Math.max(window.y, display.y);
  return width >= Math.min(VISIBLE, window.width) && height >= Math.min(VISIBLE, window.height);
}

/**
 * A remembered window position, made safe for the displays that exist now.
 *
 * A monitor is unplugged, a laptop docks, a window is remembered at -2000: without
 * this the window opens somewhere the person cannot reach it, which looks exactly
 * like a crash. Size is clamped to the display and to the minimum the UI needs.
 */
export function clampBounds(saved: Bounds, displays: readonly DisplayLike[], fallback: Bounds): Bounds {
  if (displays.length === 0) return { ...fallback };

  const size = (display: Bounds): { width: number; height: number } => ({
    width: Math.max(MIN_WIDTH, Math.min(Math.round(saved.width), display.width)),
    height: Math.max(MIN_HEIGHT, Math.min(Math.round(saved.height), display.height)),
  });

  const home = displays.find((display) => intersects(saved, display.bounds));
  if (home) {
    const { width, height } = size(home.bounds);
    const x = Math.max(home.bounds.x, Math.min(Math.round(saved.x), home.bounds.x + home.bounds.width - width));
    const y = Math.max(home.bounds.y, Math.min(Math.round(saved.y), home.bounds.y + home.bounds.height - height));
    return { x, y, width, height };
  }

  const primary = displays[0] as DisplayLike;
  const { width, height } = size(primary.bounds);
  return {
    x: Math.round(primary.bounds.x + (primary.bounds.width - width) / 2),
    y: Math.round(primary.bounds.y + (primary.bounds.height - height) / 2),
    width,
    height,
  };
}
