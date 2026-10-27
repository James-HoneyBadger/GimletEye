import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The flow a user actually performs, against a real engine: browse the
 * catalogue, be told what is missing, run a tool, read the report.
 *
 * The token path is part of it. Since 0.4 the API refuses unauthenticated calls,
 * so "the UI works" includes "the UI can find the token and use it" — the part
 * most likely to break without anyone noticing.
 */

const home = process.env.GIMLET_E2E_HOME ?? '/tmp/gimlet-e2e';

function token(): string {
  // The engine writes it on first start, mode 0600.
  return readFileSync(join(home, 'api-token'), 'utf8').trim();
}

test.describe('a live engine', () => {
  test('asks for the token when it does not have one, then works', async ({ page }) => {
    await page.goto('/');

    // Without a token the workbench is a gate, not a broken list.
    await expect(page.getByRole('heading', { name: /API token required/i })).toBeVisible();
    await expect(page.locator('[data-tool]')).toHaveCount(0);

    await page.getByLabel('API token').fill(token());
    await page.getByRole('button', { name: 'Unlock' }).click();

    // And the catalogue appears without a reload. Assert a tool that ships with
    // the toolkit rather than a count: a pack adds twenty more, and a test that
    // expects them fails wherever no pack is installed.
    await expect(page.locator('[data-tool]').first()).toBeVisible();
    await expect(page.locator('[data-tool="crypto.sha256"]')).toHaveCount(1);
    expect(await page.locator('[data-tool]').count()).toBeGreaterThan(10);
  });

  test('starts at the pillars, and a pillar opens a tool', async ({ page }) => {
    // The engine's home is removed before each run, so this is a true first run:
    // nothing remembered, nothing selected. The pillars are the way in.
    await page.goto(`/#token=${encodeURIComponent(token())}`);
    await expect(page.locator('.empty-state')).toBeVisible();

    const cards = page.locator('.hint-card');
    await expect(cards).toHaveCount(3);
    for (const card of await cards.all()) {
      await expect(card).toBeEnabled();
    }
    // Named as pillars, with a live count from the registry.
    await expect(page.locator('.hint-card strong')).toHaveText([/System/, /Crypto/, /Privacy/]);

    await page.locator('.hint-card', { hasText: 'Crypto' }).click();
    await expect(page.locator('.tool-id')).toContainText('crypto.');
    await expect(page.locator('.filter--active')).toContainText('Crypto');
    // And the choice sticks: a reload restores the tool instead of the pillars.
    await page.reload();
    await expect(page.locator('.tool-id')).toContainText('crypto.');
  });

  test('browses, validates, runs, and reads the report', async ({ page }) => {
    await page.goto(`/#token=${encodeURIComponent(token())}`);

    // Validate: a tool with a required field refuses to run without it, and says
    // which field — on this side of the wire, without asking the engine.
    await page.locator('[data-tool="privacy.metadata-scan"]').click();
    await expect(page.locator('.tool-name')).toHaveText(/Inspect metadata/i);
    await page.locator('#run').click();
    await expect(page.locator('.field-error')).toContainText('Choose a file or directory');
    await expect(page.locator('.status--ok')).toHaveCount(0);

    // Browse: pick a tool that cannot touch anything.
    await page.locator('[data-tool="crypto.sha256"]').click();
    await expect(page.locator('.tool-name')).toHaveText(/SHA-256/i);
    await expect(page.locator('.readonly')).toContainText('Read-only');

    // Run: a known answer, so the assertion is about the wire, not about hashing.
    await page.locator('#arg-text').fill('abc');
    await page.locator('#run').click();

    await expect(page.locator('.status--ok')).toBeVisible();
    await expect(page.locator('#result-region')).toContainText(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    // The report carries the CLI command, which is the bridge back to a shell.
    // (The digest has its own copy button, so match the command by text.)
    await expect(
      page.locator('#result-region [data-copy^="gimlet run crypto.sha256"]'),
    ).toHaveCount(1);
  });

  test('keeps the token across a reload instead of asking again', async ({ page }) => {
    await page.goto(`/#token=${encodeURIComponent(token())}`);
    await expect(page.locator('[data-tool]').first()).toBeVisible();

    // The fragment must not survive in the address bar.
    expect(page.url()).not.toContain('token=');

    await page.reload();
    await expect(page.locator('[data-tool]').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /API token required/i })).toHaveCount(0);
  });

  test('selects an enum with a button and sends the choice', async ({ page }) => {
    await page.goto(`/#token=${encodeURIComponent(token())}`);

    await page.locator('[data-tool="crypto.keygen"]').click();
    await expect(page.locator('.choice-group')).toBeVisible();
    await page.locator('.choice', { hasText: 'x25519' }).click();
    await expect(page.locator('.choice.is-active')).toHaveText('x25519');

    // A dry run proves the choice reached the engine without writing a key.
    await page.locator('#arg-label').fill('e2e-dry-run');
    // The checkbox itself is visually hidden inside its switch; the label is what
    // a user clicks, and clicking it has to toggle the control.
    await page.locator('.actionbar .switch').click();
    await expect(page.locator('#dry-run')).toBeChecked();
    await page.locator('#run').click();

    await expect(page.locator('.callout--info')).toContainText('Nothing was written');
    await expect(page.locator('#result-region')).toContainText('x25519');
  });
});
