import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import { readZip } from '../../scripts/lib/zip.ts';

/**
 * Loads the release archive itself (production manifest, no pre-granted
 * hosts) in Chromium. Runs only through `pnpm test:package`, which packages
 * first; playwright.config.ts leaves @package tests out of the regular E2E run.
 */
const RELEASE_DIR = 'release';
const archive = (() => {
  try {
    return readdirSync(RELEASE_DIR).find((name) =>
      /^api-qa-inspector-\d+\.\d+\.\d+\.zip$/.test(name),
    );
  } catch {
    return undefined;
  }
})();

test.describe('packaged extension @package', () => {
  test('the release zip loads in Chromium with the production manifest', async () => {
    if (archive === undefined) {
      throw new Error('No release archive in release/; run pnpm package:extension first.');
    }
    const directory = mkdtempSync(join(tmpdir(), 'api-qa-package-'));
    for (const entry of readZip(readFileSync(join(RELEASE_DIR, archive)))) {
      const target = join(directory, ...entry.path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.data);
    }
    const manifest: unknown = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).toHaveProperty('icons.128', 'icons/icon-128.png');

    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const extensionId = new URL(worker.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
      await expect(popup.getByRole('heading', { name: 'API QA Inspector' })).toBeVisible();
      const icon = await popup.goto(`chrome-extension://${extensionId}/icons/icon-128.png`);
      expect(icon?.status()).toBe(200);

      // Without a grant, the production build refuses to capture.
      const dashboard = await context.newPage();
      await dashboard.goto(`chrome-extension://${extensionId}/panel/index.html`);
      const reply: unknown = await dashboard.evaluate(() =>
        chrome.runtime.sendMessage({
          type: 'capture/start',
          tabId: 1,
          origins: ['https://example.org'],
          name: 'No grant',
        }),
      );
      expect(reply).toMatchObject({ ok: false });
    } finally {
      await context.close();
    }
  });
});
