import { TEST_APP_ORIGIN, expect, test } from '../fixtures/api-qa.js';

test.describe('13. capture lifecycle', () => {
  test('only traffic between start and stop is recorded', async ({ apiQa, page }) => {
    await page.goto(`${TEST_APP_ORIGIN}/s/idle`);
    await page.evaluate(() => fetch('/api/items?phase=before').then((response) => response.text()));

    await apiQa.start();
    await page.evaluate(() => fetch('/api/items?phase=during').then((response) => response.text()));
    const { session } = await apiQa.stop();

    await page.evaluate(() => fetch('/api/items?phase=after').then((response) => response.text()));
    expect(session.requests.map((request) => request.url)).toEqual([
      `${TEST_APP_ORIGIN}/api/items?phase=during`,
    ]);
    expect(session.endedAt).not.toBeNull();
    expect(session.endedAt ?? 0).toBeGreaterThanOrEqual(session.startedAt);
  });

  test('a request still in flight at stop is kept with an unknown outcome', async ({
    apiQa,
    page,
  }) => {
    await page.goto(`${TEST_APP_ORIGIN}/s/idle`);
    await apiQa.start();
    await page.evaluate(() => {
      void fetch('/api/slow?ms=3000');
    });
    // Give the request time to start; the server holds it for 3 s.
    await page.waitForTimeout(300);
    const { session } = await apiQa.stop({ settleMs: 100 });

    expect(session.requests).toHaveLength(1);
    expect(session.requests[0]).toMatchObject({ status: null, durationMs: null, error: null });
  });

  test('misuse fails clearly', async ({ apiQa }) => {
    await expect(apiQa.stop()).rejects.toThrow('apiQa.stop() called before apiQa.start().');
    await apiQa.start();
    await expect(apiQa.start()).rejects.toThrow('apiQa.start() was already called');
  });

  test('a capture that is never stopped is cleaned up by the fixture', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/single');
    // No stop(): teardown must detach without failing the test.
  });
});
