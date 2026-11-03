import type { MenuItemConstructorOptions } from 'electron';

export interface MenuSettings {
  platform: NodeJS.Platform;
  version: string;
  about: () => void;
}

/** Roles that would let the window reload itself or open its own devtools. */
export const FORBIDDEN_ROLES = ['reload', 'forceReload', 'toggleDevTools'] as const;

/**
 * The menu, as data.
 *
 * Kept out of `menu.ts` so a test can assert what is *not* in it: the default
 * Electron menu offers Reload, Force Reload and Toggle Developer Tools, and the
 * window is a local document whose state a reload would discard. Editing and zoom
 * stay, because a keyboard user needs them.
 */
export function menuTemplate({ platform, about }: MenuSettings): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [];
  if (mac) template.push({ role: 'appMenu' });
  template.push({ label: 'File', submenu: [mac ? { role: 'close' } : { role: 'quit' }] });
  template.push({ role: 'editMenu' });
  template.push({
    label: 'View',
    submenu: [
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });
  template.push({ role: 'windowMenu' });
  template.push({ label: 'Help', submenu: [{ label: 'About Gimlet Works', click: () => about() }] });
  return template;
}

/** Every role anywhere in a template, for the "nothing reloads" assertion. */
export function rolesIn(template: MenuItemConstructorOptions[]): string[] {
  const roles: string[] = [];
  for (const item of template) {
    if (typeof item.role === 'string') roles.push(item.role);
    if (Array.isArray(item.submenu)) roles.push(...rolesIn(item.submenu));
  }
  return roles;
}
