import { describe, expect, it } from 'vitest';

import { FORBIDDEN_ROLES, menuTemplate, rolesIn } from './menu-template.js';

const linux = menuTemplate({ platform: 'linux', version: '1.0.0', about: () => undefined });
const mac = menuTemplate({ platform: 'darwin', version: '1.0.0', about: () => undefined });

describe('the application menu', () => {
  it('offers no way to reload the window or open its devtools', () => {
    for (const template of [linux, mac]) {
      const roles = rolesIn(template);
      for (const forbidden of FORBIDDEN_ROLES) {
        expect(roles, `${forbidden} in ${roles.join(', ')}`).not.toContain(forbidden);
      }
    }
  });

  it('keeps editing, zoom, and fullscreen', () => {
    const roles = rolesIn(linux);
    expect(roles).toContain('editMenu');
    expect(roles).toContain('zoomIn');
    expect(roles).toContain('zoomOut');
    expect(roles).toContain('resetZoom');
    expect(roles).toContain('togglefullscreen');
  });

  it('gives a Mac the application menu and a Quit that is not Close', () => {
    expect(rolesIn(mac)).toContain('appMenu');
    expect(rolesIn(linux)).toContain('quit');
    expect(rolesIn(mac)).toContain('close');
  });

  it('names the build in Help, rather than showing a version nobody can find', () => {
    const help = linux.find((item) => item.label === 'Help');
    expect(help?.submenu).toBeDefined();
  });
});
