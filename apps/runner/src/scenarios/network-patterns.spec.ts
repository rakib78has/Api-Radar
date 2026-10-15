import { expectNoFindings, findingsOfType } from '../fixtures/assertions.js';
import { TEST_APP_ORIGIN, expect, test } from '../fixtures/api-qa.js';

test.describe('request patterns', () => {
  test('1. a single API request produces no findings', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/single');
    const { session, analysis } = await apiQa.stop();

    const api = session.requests.filter((request) => request.resourceType === 'api');
    expect(api).toHaveLength(1);
    expect(api[0]).toMatchObject({
      method: 'GET',
      status: 200,
      source: 'playwright',
      url: `${TEST_APP_ORIGIN}/api/items`,
      context: { tabId: 1, frameId: 0 },
    });
    expect(api[0]?.context.documentId).not.toBeNull();
    expect(api[0]?.durationMs).not.toBeNull();
    expectNoFindings(analysis);
  });

  test('2. repeated identical GETs are reported as a duplicate', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/duplicate-get');
    const { analysis } = await apiQa.stop();

    const duplicates = findingsOfType(analysis, 'duplicate-request');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      severity: 'low',
      confidence: 'high',
      endpoint: `GET ${TEST_APP_ORIGIN}/api/items`,
      evidence: { requestCount: 2 },
    });
  });

  test('3. different query parameters are not duplicates', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/query-params');
    const { session, analysis } = await apiQa.stop();

    const endpoints = new Set(session.requests.map((request) => request.fingerprint.endpoint));
    expect(endpoints.has(`GET ${TEST_APP_ORIGIN}/api/items`)).toBe(true);
    expectNoFindings(analysis);
  });

  test('4. different resource identifiers are not duplicates', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/resource-ids');
    const { analysis } = await apiQa.stop();

    // Both requests share one endpoint template but are different operations.
    expect(
      analysis.endpointStats.find((stats) => stats.endpoint.endsWith('/api/users/:id')),
    ).toMatchObject({
      requestCount: 2,
    });
    expectNoFindings(analysis);
  });

  test('5. legitimate concurrent requests to different endpoints pass', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/concurrent');
    const { analysis } = await apiQa.stop();

    expect(analysis.analysedRequestCount).toBe(3);
    expectNoFindings(analysis);
  });
});
