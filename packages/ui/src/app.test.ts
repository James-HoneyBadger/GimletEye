// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tools = [
  {
    id: 'demo.echo',
    title: 'Echo',
    summary: 'read a file and report its size',
    category: 'sysadmin',
    origin: 'builtin',
    mutates: false,
    capabilities: ['fs:read'],
    tags: ['demo'],
    args: [{ name: 'input', type: 'path', required: true, help: 'File to read' }],
  },
  {
    id: 'demo.write',
    title: 'Write',
    summary: 'rewrite a file',
    category: 'privacy',
    origin: 'builtin',
    mutates: true,
    args: [],
  },
  {
    id: 'demo.enum',
    title: 'Choices',
    summary: 'pick a profile and a level',
    category: 'crypto',
    origin: 'builtin',
    mutates: false,
    args: [
      { name: 'profile', type: 'enum', values: ['sharing', 'archive'], default: 'sharing', help: 'Removal profile' },
      { name: 'level', type: 'enum', values: ['a', 'b', 'c', 'd', 'e', 'f'], default: 'a' },
    ],
  },
];

const report = {
  tool: 'demo.echo',
  status: 'ok',
  summary: 'read 4 bytes',
  data: { input: '/tmp/a.txt', dry_run: false },
  duration_ms: 3,
};

const calls: string[] = [];
const runBodies: { tool: string; args: Record<string, unknown> }[] = [];

function json(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
}

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
  runBodies.length = 0;
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage.clear();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/health')) return json({ status: 'ok', version: '0.1.0', tools: 2, packs: 1 });
    if (url.includes('/tools')) return json(tools);
    if (url.includes('/packs')) {
      return json([{ name: 'demo-pack', version: '1.0.0', dir: '/tmp/pack', tool_count: 2, capabilities: ['fs:read'] }]);
    }
    if (url.includes('/audit')) {
      return json({
        enabled: true,
        path: '/tmp/audit.jsonl',
        entries: [{ ts: new Date().toISOString(), tool: 'demo.echo', status: 'ok', duration_ms: 3, arg_keys: ['input'] }],
      });
    }
    if (url.includes('/run')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      runBodies.push(body);
      return json({
        ...report,
        tool: body.tool,
        data: { ...(report.data as object), dry_run: body.dry_run === true },
      });
    }
    throw new Error(`unexpected request ${url}`);
  });
});

async function boot() {
  await import('./main');
  await vi.waitFor(() => expect(document.querySelectorAll('[data-tool]').length).toBe(3));
}

/** Open a tool the way a user does: click it in the list. */
async function openTool(id: string) {
  document.querySelector<HTMLElement>(`[data-tool="${id}"]`)!.click();
  await vi.waitFor(() =>
    expect(document.querySelector('.tool--active')?.getAttribute('data-tool')).toBe(id),
  );
}

describe('workbench shell', () => {
  it('lists tools and opens one without a manual refresh', async () => {
    await boot();
    await openTool('demo.echo');
    expect(document.querySelector('.tool-name')?.textContent).toContain('Echo');
    expect(document.querySelector('#arg-input')).not.toBeNull();
  });

  it('lands on the pillars on a first run instead of picking a tool', async () => {
    await boot();
    // Nothing is open, so the three pillars are the way in rather than decoration.
    expect(document.querySelector('.empty-state')).not.toBeNull();
    expect(document.querySelector('.tool--active')).toBeNull();
    expect(document.querySelectorAll('.hint-card').length).toBe(3);
  });

  it('blocks a run and explains which field is missing', async () => {
    await boot();
    await openTool('demo.echo');
    document.querySelector<HTMLButtonElement>('#run')!.click();

    await vi.waitFor(() => expect(document.querySelector('.field-error')?.textContent).toContain('Choose a file'));
    expect(calls.some((call) => call.includes('/run'))).toBe(false);
  });

  it('runs the tool and shows the report with a copyable CLI command', async () => {
    await boot();
    await openTool('demo.echo');
    const input = document.querySelector<HTMLInputElement>('#arg-input')!;
    input.value = '/tmp/a.txt';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector<HTMLButtonElement>('#run')!.click();

    await vi.waitFor(() => expect(document.querySelector('.status--ok')).not.toBeNull());
    expect(document.querySelector('.result-summary')?.textContent).toContain('read 4 bytes');
    const copyCommand = document.querySelector('#result-region [data-copy]');
    expect(copyCommand?.getAttribute('data-copy')).toBe('gimlet run demo.echo input=/tmp/a.txt');
  });

  it('keeps a typed value when the tool is re-selected', async () => {
    await boot();
    await openTool('demo.echo');
    const input = document.querySelector<HTMLInputElement>('#arg-input')!;
    input.value = '/tmp/kept.txt';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector<HTMLElement>('[data-tool="demo.write"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.tool--active')?.getAttribute('data-tool')).toBe('demo.write'));
    document.querySelector<HTMLElement>('[data-tool="demo.echo"]')!.click();

    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>('#arg-input')?.value).toBe('/tmp/kept.txt'),
    );
  });

  it('offers a dry run only for tools that write', async () => {
    await boot();
    await openTool('demo.echo');
    expect(document.querySelector('.readonly')?.textContent).toContain('Read-only');
    expect(document.querySelector('#dry-run')).toBeNull();
    expect(document.querySelector('[data-tool="demo.echo"] .tool-flag')).toBeNull();
    expect(document.querySelector('[data-tool="demo.write"] .tool-flag')?.textContent).toContain('writes');

    document.querySelector<HTMLElement>('[data-tool="demo.write"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#dry-run')).not.toBeNull());
  });

  it('says plainly when a dry run wrote nothing', async () => {
    await boot();
    document.querySelector<HTMLElement>('[data-tool="demo.write"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#dry-run')).not.toBeNull());

    const toggle = document.querySelector<HTMLInputElement>('#dry-run')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#run')!.click();

    await vi.waitFor(() => expect(document.querySelector('.callout--info')?.textContent).toContain('Nothing was written'));
    const copyCommand = document.querySelector('#result-region [data-copy]');
    expect(copyCommand?.getAttribute('data-copy')).toBe('gimlet run demo.write --dry-run');
  });

  it('moves focus into the form after a pointer selection, not the list', async () => {
    await boot();
    await openTool('demo.echo');
    const row = document.querySelector<HTMLElement>('[data-tool="demo.write"]')!;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    await vi.waitFor(() =>
      expect(document.querySelector('.tool--active')?.getAttribute('data-tool')).toBe('demo.write'),
    );
    // demo.write has no arguments, so the run button is the next thing to use.
    expect(document.activeElement).toBe(document.querySelector('#run'));

    // A keyboard selection keeps focus in the list so arrows keep working.
    const echo = document.querySelector<HTMLElement>('[data-tool="demo.echo"]')!;
    echo.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await vi.waitFor(() =>
      expect(document.querySelector('.tool--active')?.getAttribute('data-tool')).toBe('demo.echo'),
    );
    expect(document.activeElement).toBe(document.querySelector('.tool--active'));
  });

  it('renders a short enum as buttons, not a dropdown', async () => {
    await boot();
    document.querySelector<HTMLElement>('[data-tool="demo.enum"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#arg-profile-label')).not.toBeNull());

    // No native popup to open: every option is a button you can click once.
    expect(document.querySelector('#arg-profile')).toBeNull();
    const group = document.querySelector<HTMLElement>('.choice-group')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    const choices = [...group.querySelectorAll<HTMLElement>('.choice')];
    expect(choices.map((choice) => choice.textContent?.trim())).toEqual(['sharing', 'archive']);
    expect(choices[0].classList.contains('is-active')).toBe(true);
    expect(group.querySelectorAll<HTMLInputElement>('input[type="radio"]').length).toBe(2);
  });

  it('keeps a long enum a dropdown', async () => {
    await boot();
    document.querySelector<HTMLElement>('[data-tool="demo.enum"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#arg-level')).not.toBeNull());
    expect(document.querySelector<HTMLElement>('#arg-level')?.tagName).toBe('SELECT');
  });

  it('sends the option chosen with a button', async () => {
    await boot();
    document.querySelector<HTMLElement>('[data-tool="demo.enum"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.choice-group')).not.toBeNull());

    const archive = [...document.querySelectorAll<HTMLElement>('.choice')].find(
      (choice) => choice.textContent?.trim() === 'archive',
    )!;
    archive.querySelector<HTMLInputElement>('input')!.click();

    expect(archive.classList.contains('is-active')).toBe(true);
    expect(document.querySelectorAll('.choice.is-active').length).toBe(1);

    document.querySelector<HTMLButtonElement>('#run')!.click();
    await vi.waitFor(() => expect(document.querySelector('.status--ok')).not.toBeNull());
    expect(runBodies.at(-1)?.args).toMatchObject({ profile: 'archive', level: 'a' });
  });

  it('remembers a chosen option when the tool is re-selected', async () => {
    await boot();
    document.querySelector<HTMLElement>('[data-tool="demo.enum"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.choice-group')).not.toBeNull());

    const archive = [...document.querySelectorAll<HTMLElement>('.choice')].find(
      (choice) => choice.textContent?.trim() === 'archive',
    )!;
    archive.querySelector<HTMLInputElement>('input')!.click();

    document.querySelector<HTMLElement>('[data-tool="demo.write"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.tool--active')?.getAttribute('data-tool')).toBe('demo.write'));
    document.querySelector<HTMLElement>('[data-tool="demo.enum"]')!.click();

    await vi.waitFor(() => expect(document.querySelectorAll('.choice.is-active').length).toBe(1));
    expect(document.querySelector('.choice.is-active')?.textContent?.trim()).toBe('archive');
  });

  it('offers the pillars as buttons that open a tool in one click', async () => {
    await boot();
    expect(document.querySelector('.empty-state')).not.toBeNull();

    const cards = [...document.querySelectorAll<HTMLButtonElement>('.hint-card')];
    expect(cards.length).toBeGreaterThan(0);
    // The complaint: they used to be divs, so this is the assertion that matters.
    for (const card of cards) {
      expect(card.tagName).toBe('BUTTON');
      expect(card.disabled).toBe(false);
    }
    expect(cards.map((card) => card.textContent?.trim().slice(0, 6))).toContain('Crypto');

    const crypto = cards.find((card) => card.textContent?.includes('Crypto'))!;
    crypto.click();

    // It both narrows the catalogue and takes you somewhere.
    await vi.waitFor(() => expect(document.querySelector('.empty-state')).toBeNull());
    await vi.waitFor(() => expect(document.querySelector('.tool--active')).not.toBeNull());
    expect(document.querySelector('.filter--active')?.textContent).toContain('Crypto');
    // demo.enum is the only tool in the crypto category of this fixture.
    expect(document.querySelector('.tool-id')?.textContent).toBe('demo.enum');
  });

  it('does not pretend the pillars work before tools have loaded', async () => {
    // The empty screen also covers a slow start and an unreachable engine, where
    // there is nothing to open. A card that looks clickable and cannot go
    // anywhere is the bug this whole change is about.
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/health')) return json({ status: 'ok', version: '0.1.0', tools: 0, packs: 0 });
      if (url.includes('/tools')) return json([]);
      if (url.includes('/packs')) return json([]);
      if (url.includes('/audit')) return json({ enabled: false, path: '', entries: [] });
      throw new Error(`unexpected request ${url}`);
    });

    await import('./main');
    await vi.waitFor(() => expect(document.querySelector('.empty-state')).not.toBeNull());

    const cards = [...document.querySelectorAll<HTMLButtonElement>('.hint-card')];
    expect(cards.length).toBe(3);
    for (const card of cards) {
      expect(card.tagName).toBe('BUTTON');
      expect(card.disabled).toBe(true);
      expect(card.hasAttribute('data-open-category')).toBe(false);
    }
    // The pillars are still named, so the screen still says what this is.
    expect(cards.map((card) => card.querySelector('strong')?.textContent)).toEqual([
      'System0',
      'Crypto0',
      'Privacy0',
    ]);
  });

  it('opens and closes the packs sheet', async () => {
    await boot();
    document.querySelector<HTMLElement>('#show-packs')!.click();

    await vi.waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull());
    expect(document.querySelector('.pack')?.textContent).toContain('demo-pack');

    document.querySelector<HTMLElement>('.sheet-head [data-sheet-close]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.sheet')).toBeNull());
  });

  it('keeps Tab inside an open sheet and gives focus back on close', async () => {
    await boot();
    const trigger = document.querySelector<HTMLElement>('#show-history')!;
    trigger.focus();
    trigger.click();
    await vi.waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull());

    const close = document.querySelector<HTMLElement>('.sheet-head .icon-button')!;
    const runs = [...document.querySelectorAll<HTMLElement>('.run-tool')];
    expect(runs.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(close);

    // Tab on the last control wraps to the first.
    const last = runs[runs.length - 1];
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(close);

    // Shift+Tab on the first wraps to the last.
    close.focus();
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);

    close.click();
    await vi.waitFor(() => expect(document.querySelector('.sheet')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('shows recent runs from the audit trail', async () => {
    await boot();
    document.querySelector<HTMLElement>('#show-history')!.click();

    await vi.waitFor(() => expect(document.querySelector('.run')).not.toBeNull());
    expect(document.querySelector('.run-tool')?.textContent).toBe('demo.echo');
  });

  it('lists groups in the same order as the category chips', async () => {
    await boot();
    const groups = [...document.querySelectorAll<HTMLElement>('[data-group]')].map((el) => el.dataset.group);
    const chips = [...document.querySelectorAll<HTMLElement>('[data-category]')]
      .map((el) => el.dataset.category)
      .filter((value) => value !== '');
    expect(groups).toEqual(chips);
  });

  it('filters the sidebar by capability, as the search box promises', async () => {
    await boot();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'fs:read';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(document.querySelectorAll('[data-tool]').length).toBe(1));
    expect(document.querySelector('[data-tool]')?.getAttribute('data-tool')).toBe('demo.echo');
  });
});
