import { expectNoFindings, findingsOfType } from '../fixtures/assertions.js';
import { TEST_APP_ORIGIN, expect, test } from '../fixtures/api-qa.js';

test.describe('8. requests continuing after navigation', () => {
  test.use({ rules: 'spa' });

  test('polling that survives a route change is reported', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/spa?interval=150&before=3&after=700');
    const { session, analysis } = await apiQa.stop();

    // The route change is a same-document navigation: same documentId, new URL.
    const [load, routeChange] = session.navigations;
    expect(routeChange?.url).toBe(`${TEST_APP_ORIGIN}/s/spa-settings`);
    expect(routeChange?.context.documentId).toBe(load?.context.documentId);

    const leaks = findingsOfType(analysis, 'request-after-navigation');
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({
      endpoint: `GET ${TEST_APP_ORIGIN}/api/status`,
      confidence: 'medium',
    });
    expect(Number(leaks[0]?.evidence.measurements.callsAfter)).toBeGreaterThanOrEqual(2);
  });

  test('a view that stops polling when it is left passes', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/spa?interval=150&before=3&after=700&fixed=1');
    const { analysis } = await apiQa.stop();

    expectNoFindings(analysis);
  });

  test('a full page load gets a new document id', async ({ apiQa, page }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/single');
    await apiQa.runScenario('/s/single');
    const { session } = await apiQa.stop();

    const documents = new Set(
      session.navigations.map((navigation) => navigation.context.documentId),
    );
    expect(session.navigations).toHaveLength(2);
    expect(documents.size).toBe(2);
    expect(page.url()).toBe(`${TEST_APP_ORIGIN}/s/single`);
  });
});
