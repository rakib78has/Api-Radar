import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test';

import { startTestServer, type TestServer } from './server.js';

/** The E2E build: identical to production except it pre-grants http://127.0.0.1/*. */
export const EXTENSION_DIR = fileURLToPath(
  new URL('../../../apps/extension/dist-e2e', import.meta.url),
);

interface WorkerFixtures {
  readonly extensionContext: BrowserContext;
  readonly extensionId: string;
  readonly server: TestServer;
}

interface TestFixtures {
  /** A page of the test application, in the tab that gets captured. */
  readonly appPage: Page;
  /** The extension dashboard, used to send commands as a trusted extension page. */
  readonly dashboard: Page;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  extensionContext: [
    async ({ headless, launchOptions }, use) => {
      if (!existsSync(EXTENSION_DIR)) {
        throw new Error(`Build the E2E extension first: pnpm --filter @api-qa/extension build:e2e`);
      }
      // Extensions need a persistent context; channel "chromium" uses the new headless mode.
      // `headless` follows --headed; slowMo comes from API_QA_SLOW_MO (playwright.config.ts).
      const context = await chromium.launchPersistentContext('', {
        headless,
        ...(launchOptions.slowMo === undefined ? {} : { slowMo: launchOptions.slowMo }),
        channel: 'chromium',
        args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  extensionId: [
    async ({ extensionContext }, use) => {
      const worker =
        extensionContext.serviceWorkers()[0] ??
        (await extensionContext.waitForEvent('serviceworker'));
      const id = new URL(worker.url()).host;
      await use(id);
    },
    { scope: 'worker' },
  ],

  server: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here.
    async ({}, use) => {
      const server = await startTestServer();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  appPage: async ({ extensionContext, server }, use) => {
    const page = await extensionContext.newPage();
    await page.goto(`${server.origin}/app.html`);
    await use(page);
    await page.close();
  },

  dashboard: async ({ extensionContext, extensionId }, use) => {
    const page = await extensionContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/panel/index.html`);
    // Start every test from an empty, idle extension.
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'capture/stop' });
      await chrome.runtime.sendMessage({ type: 'sessions/clear' });
      await chrome.runtime.sendMessage({ type: 'settings/reset-rules' });
    });
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';

/** Sends a command from an extension page and returns the validated reply. */
export function command(page: Page, message: Record<string, unknown>): Promise<unknown> {
  return page.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
}

/** The tab id of the first tab showing `origin`. */
export async function tabIdOf(dashboard: Page, origin: string): Promise<number> {
  const id = await dashboard.evaluate(async (pattern) => {
    const [tab] = await chrome.tabs.query({ url: pattern });
    return tab?.id ?? -1;
  }, `${origin}/*`);
  if (id < 0) {
    throw new Error(`No tab found for ${origin}`);
  }
  return id;
}

/** The dashboard page for one session. */
export function dashboardUrl(extensionId: string, sessionId: string): string {
  return `chrome-extension://${extensionId}/panel/index.html?session=${encodeURIComponent(sessionId)}`;
}
