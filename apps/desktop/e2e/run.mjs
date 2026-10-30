#!/usr/bin/env node
/**
 * The app, end to end, against the real thing.
 *
 * Every other test of the window mocks the bridge, so a break in the wiring —
 * an IPC channel renamed, a handler that validates too much, a run that never
 * reaches the audit trail — is invisible to them. This launches Electron,
 * drives the interface, and then reads the files the app wrote.
 *
 * It needs a display. On a headless machine run it under `xvfb-run`, which is
 * what the CI job does.
 *
 * Usage: node apps/desktop/e2e/run.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NODE_TOOLS } from '@gimlet-eye/core/node';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');

const { _electron: electron } = await import('playwright');

const home = mkdtempSync(join(tmpdir(), 'gimlet-e2e-'));
const steps = [];
const step = (name) => {
  steps.push(name);
  process.stdout.write(`  ok  ${name}\n`);
};

let failure = null;
let electronApp;

try {
  electronApp = await electron.launch({
    args: [app, '--ozone-platform=x11'],
    env: { ...process.env, GIMLET_HOME: home, GIMLET_SIDECAR: join(home, 'no-engine') },
    timeout: 60_000,
  });

  const window = await electronApp.firstWindow();

  // The window is a local document: anything that is not a local scheme is a
  // regression the session is supposed to cancel. Recording it here means the
  // claim is tested rather than asserted in a comment.
  const external = [];
  window.on('request', (request) => {
    if (!/^(file|data|blob|devtools|chrome-extension):/i.test(request.url())) external.push(request.url());
  });

  // `show: false` until the renderer is ready, so this waits for a real page.
  await window.waitForSelector('.sidebar', { timeout: 30_000 });
  assert.equal(await window.title(), 'Gimlet Eye');
  step('the window opens on the real page');

  // The catalogue comes from the main process over IPC, so a broken channel
  // means an empty sidebar rather than a failed assertion somewhere later. The
  // sidebar opens on the Crypto filter, so "all" has to be chosen first — the
  // count below is of rows rendered, not of tools known.
  await window.getByRole('tab', { name: /^All/ }).click();
  const rows = await window.locator('.tool').count();
  // The count comes from the same list the main process registers, so adding a
  // tool cannot leave this asserting a number from two releases ago.
  assert.equal(rows, NODE_TOOLS.length, `expected ${NODE_TOOLS.length} tools in the sidebar, saw ${rows}`);
  step(`the catalogue arrives over IPC (${NODE_TOOLS.length} tools)`);

  const footer = await window.locator('.sidebar-footer').innerText();
  assert.match(footer, /engine built in/, `footer read: ${footer}`);
  step('the footer names the built-in engine');

  // A tool that needs no filesystem input, run the way a person would. The
  // sidebar keeps whatever was selected when the filter changed, so the tool is
  // named rather than assumed.
  await window.click('[data-tool="crypto.sha256"]');
  await window.fill('input[name="text"]', 'hello');
  await window.getByRole('button', { name: /^Run$/ }).click();

  // The digest is the tool's own answer: this asserts the report travelled
  // back from the main process and rendered, not that a spinner stopped.
  await window.waitForSelector('text=2cf24dba5fb0a30e', { timeout: 30_000 });
  step('a run reaches the report view');

  assert.deepEqual(external, [], `the window made a non-local request: ${external.join(', ')}`);
  step('the window made no network request');

  // The audit trail is written by the main process, so this is the check that
  // the window went through `Runtime.run` rather than around it.
  const audit = readFileSync(join(home, 'audit.jsonl'), 'utf8').trim().split('\n');
  const last = JSON.parse(audit.at(-1));
  assert.equal(last.tool, 'crypto.sha256');
  assert.equal(last.status, 'ok');
  step('the run landed in the audit trail');

  // No argument values in the trail: the passphrase rule applies to every tool.
  assert.ok(!audit.join('\n').includes('hello'), 'the audit trail must not carry argument values');
  step('the trail carries names, not values');
} catch (error) {
  failure = error;
} finally {
  await electronApp?.close().catch(() => undefined);
  rmSync(home, { recursive: true, force: true });
}

if (failure !== null) {
  console.error(`\ne2e failed after ${steps.length} step(s): ${failure.message}`);
  process.exit(1);
}
console.log(`\ne2e: ${steps.length} checks passed against the real app`);
