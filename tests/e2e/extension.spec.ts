import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import {
  responseMessageSchema,
  type CaptureStatus,
} from '../../apps/extension/src/shared/messages.js';
import { command, dashboardUrl, expect, tabIdOf, test } from './support/extension.js';

/** The capture status from a successful reply, validated with the schema the UI uses. */
function statusOf(value: unknown): CaptureStatus {
  const reply = responseMessageSchema.parse(value);
  if (!reply.ok) {
    throw new Error(`Command failed: ${reply.error} ${reply.issues.join(' ')}`);
  }
  return reply.status;
}

/** The error from a refused command; fails if the command succeeded. */
function errorOf(value: unknown): string {
  const reply = responseMessageSchema.parse(value);
  if (reply.ok) {
    throw new Error('Expected the command to be refused');
  }
  return reply.error;
}

async function startCapture(dashboard: Page, origin: string, name: string): Promise<string> {
  const tabId = await tabIdOf(dashboard, origin);
  const status = statusOf(
    await command(dashboard, { type: 'capture/start', tabId, origins: [origin], name }),
  );
  if (!status.active) {
    throw new Error('The capture did not start');
  }
  return status.sessionId;
}

/** webRequest events reach the worker asynchronously; wait until they are recorded. */
async function waitForRequests(dashboard: Page, count: number): Promise<void> {
  await expect
    .poll(async () => {
      const status = statusOf(await command(dashboard, { type: 'capture/status' }));
      return status.active ? status.requestCount : 0;
    })
    .toBeGreaterThanOrEqual(count);
}

test.describe('extension smoke @smoke', () => {
  test('loads the service worker, popup and dashboard', async ({
    extensionContext,
    extensionId,
  }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const popup = await extensionContext.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await expect(popup.getByRole('heading', { name: 'API QA Inspector' })).toBeVisible();
    // The popup's own tab is not an http(s) page.
    await expect(popup.getByText('Open an http or https page')).toBeVisible();
    await popup.close();

    const dashboard = await extensionContext.newPage();
    await dashboard.goto(`chrome-extension://${extensionId}/panel/index.html`);
    await expect(dashboard.getByRole('tab', { name: 'Findings' })).toBeVisible();
    await dashboard.getByRole('tab', { name: 'Permissions & limits' }).click();
    await expect(dashboard.getByText('http://127.0.0.1/*')).toBeVisible();
    await dashboard.close();
  });

  test('web pages cannot reach the extension', async ({ appPage }) => {
    const exposed = await appPage.evaluate(
      () =>
        typeof (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime
          ?.sendMessage,
    );
    expect(exposed).toBe('undefined');
  });
});

test.describe('capture through chrome.webRequest', () => {
  test('finds duplicates and retry loops, redacts secrets, and exports a safe report', async ({
    appPage,
    dashboard,
    server,
    extensionId,
  }) => {
    const sessionId = await startCapture(dashboard, server.origin, 'E2E checkout');

    await appPage.evaluate(async () => {
      await Promise.all([
        fetch('/api/items?token=E2E-SECRET-1'),
        fetch('/api/items?token=E2E-SECRET-1'),
      ]);
      const order = { method: 'POST', headers: { 'content-type': 'application/json' } };
      await fetch('/api/orders', { ...order, body: '{"sku":"A1","qty":1}' });
      await fetch('/api/orders', { ...order, body: '{"qty":1,"sku":"A1"}' });
      for (let attempt = 0; attempt < 5; attempt++) {
        await fetch('/api/flaky');
      }
    });
    await waitForRequests(dashboard, 9);
    expect(statusOf(await command(dashboard, { type: 'capture/stop' }))).toEqual({ active: false });

    // Nothing secret reached storage.
    const stored = await dashboard.evaluate(async () =>
      JSON.stringify(await chrome.storage.local.get(null)),
    );
    expect(stored).not.toContain('E2E-SECRET-1');
    expect(stored).toContain('token=[REDACTED]');

    await dashboard.goto(dashboardUrl(extensionId, sessionId));
    await expect(dashboard.getByRole('heading', { name: 'E2E checkout' })).toBeVisible();
    await expect(dashboard.getByRole('region', { name: 'Duplicate request' })).toBeVisible();
    await expect(
      dashboard.getByRole('article', { name: 'POST request sent 2 times' }),
    ).toBeVisible();
    await expect(
      dashboard.getByRole('article', { name: 'GET request sent 2 times' }),
    ).toBeVisible();
    await expect(dashboard.getByRole('region', { name: 'Retry loop' })).toBeVisible();

    // Triage survives a reload.
    const postCard = dashboard.getByRole('article', { name: 'POST request sent 2 times' });
    await postCard.getByRole('button', { name: 'Confirm bug' }).click();
    await expect(postCard.getByText('confidence high · confirmed')).toBeVisible();
    await dashboard.reload();
    await expect(
      dashboard.getByRole('article', { name: 'POST request sent 2 times' }).getByText('confirmed'),
    ).toBeVisible();

    // Requests tab shows the sanitised traffic.
    await dashboard.getByRole('tab', { name: 'Requests' }).click();
    await expect(dashboard.getByText('/api/flaky').first()).toBeVisible();
    await expect(dashboard.getByText('E2E-SECRET-1')).toHaveCount(0);

    // The HTML export is escaped, script-free and sanitised.
    const download = dashboard.waitForEvent('download');
    await dashboard.getByRole('button', { name: 'HTML' }).click();
    const file = await (await download).path();
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('POST request sent 2 times');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('<script');
    expect(html).not.toContain('E2E-SECRET-1');
  });

  test('applies saved rules: forbidden endpoints and expected counts', async ({
    appPage,
    dashboard,
    server,
    extensionId,
  }) => {
    const rules = JSON.stringify({
      schemaVersion: 1,
      name: 'E2E rules',
      endpoints: [
        { id: 'no-status', match: { path: '/api/status' }, forbidden: true },
        { id: 'one-items', match: { method: 'GET', path: '/api/items' }, expectedCount: 1 },
      ],
    });
    statusOf(await command(dashboard, { type: 'settings/save-rules', text: rules }));
    const invalid = errorOf(
      await command(dashboard, {
        type: 'settings/save-rules',
        text: '{"schemaVersion":1,"nope":1}',
      }),
    );
    expect(invalid).toBe('The rule set is not valid.');

    const sessionId = await startCapture(dashboard, server.origin, 'E2E rules run');
    await appPage.evaluate(async () => {
      await fetch('/api/status');
      await fetch('/api/items');
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await fetch('/api/items');
    });
    await waitForRequests(dashboard, 3);
    await command(dashboard, { type: 'capture/stop' });

    await dashboard.goto(dashboardUrl(extensionId, sessionId));
    await expect(dashboard.getByText('rules “E2E rules”')).toBeVisible();
    await expect(dashboard.getByRole('region', { name: 'Forbidden endpoint' })).toBeVisible();
    await expect(dashboard.getByRole('region', { name: 'Unexpected call count' })).toBeVisible();
    await expect(dashboard.getByRole('region', { name: 'Duplicate request' })).toHaveCount(0);
  });

  test('records navigations and ends the capture when the tab closes', async ({
    extensionContext,
    dashboard,
    server,
  }) => {
    const page = await extensionContext.newPage();
    await page.goto(`${server.origin}/app.html`);
    const sessionId = await startCapture(dashboard, server.origin, 'E2E navigation');
    await page.goto(`${server.origin}/next.html?session=E2E-SECRET-2`);
    await page.evaluate(() => fetch('/api/items'));
    await waitForRequests(dashboard, 1);
    await page.close();

    await expect
      .poll(async () => statusOf(await command(dashboard, { type: 'capture/status' })).active)
      .toBe(false);
    const session = await dashboard.evaluate(
      async (id) => (await chrome.storage.local.get(`session:${id}:meta`))[`session:${id}:meta`],
      sessionId,
    );
    const text = JSON.stringify(session);
    expect(text).toContain('/next.html?session=[REDACTED]');
    expect(text).not.toContain('E2E-SECRET-2');
    expect(text).toMatch(/"endedAt":\d/);
  });

  test('refuses a capture for an origin without site access', async ({
    dashboard,
    appPage,
    server,
  }) => {
    const tabId = await tabIdOf(dashboard, server.origin);
    const error = errorOf(
      await command(dashboard, {
        type: 'capture/start',
        tabId,
        origins: ['https://not-granted.example'],
        name: 'Denied',
      }),
    );
    expect(error).toContain('Site access');
    expect(appPage.url()).toContain('/app.html');
  });
});
