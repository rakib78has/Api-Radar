import { expectNoFindings, findingsOfType } from '../fixtures/assertions.js';
import { TEST_APP_ORIGIN, expect, test } from '../fixtures/api-qa.js';

test.describe('9. forbidden endpoint calls', () => {
  test.use({ rules: 'forbidden' });

  test('a call to a retired API fails the run', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/forbidden');
    const { analysis } = await apiQa.stop();

    const forbidden = findingsOfType(analysis, 'forbidden-endpoint');
    expect(forbidden).toHaveLength(1);
    expect(forbidden[0]).toMatchObject({
      ruleId: 'no-v1',
      severity: 'high',
      endpoint: `GET ${TEST_APP_ORIGIN}/api/v1/legacy`,
    });
    expect(() => {
      expectNoFindings(analysis, 'high');
    }).toThrow(/forbidden-endpoint: Forbidden endpoint ANY \/api\/v1\/\*\* was called/);
  });

  test('the required endpoint called exactly once passes', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/single');
    const { analysis } = await apiQa.stop();

    expectNoFindings(analysis);
  });

  test('a required endpoint that is never called is reported', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/idle');
    const { analysis } = await apiQa.stop();

    expect(findingsOfType(analysis, 'missing-required-endpoint')).toHaveLength(1);
  });
});
