import { Menu } from 'electron';

import { menuTemplate, type MenuSettings } from './menu-template.js';

export function installMenu(settings: MenuSettings): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(settings)));
}
