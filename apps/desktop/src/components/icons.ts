const svg = (path: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${path}</svg>`;

export const icons = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'),
  play: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
  check: svg('<path d="m4 12.5 5 5L20 6.5"/>'),
  warning: svg('<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17h.01"/>'),
  error: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  download: svg('<path d="M12 4v11M7.5 11 12 15.5 16.5 11"/><path d="M4.5 19.5h15"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  terminal: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>'),
  shield: svg('<path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3Z"/>'),
  broom: svg('<path d="M14 4l6 6M9 9l6 6-4 5H5l-1-6 5-5Z"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 4l3 3M14 7l3 3"/>'),
  database: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>'),
  refresh: svg('<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16M4 20v-4h4"/>'),
};

export function categoryIcon(category: string): string {
  switch (category) {
    case 'sysadmin':
      return icons.terminal;
    case 'crypto':
      return icons.key;
    case 'privacy':
      return icons.broom;
    case 'forensics':
      return icons.database;
    case 'automation':
      return icons.refresh;
    default:
      return icons.layers;
  }
}
