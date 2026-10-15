import { expectNoFindings, findingsOfType } from '../fixtures/assertions.js';
import { expect, test } from '../fixtures/api-qa.js';

test.describe('6. configured retry sequences', () => {
  test.use({ rules: 'retry' });

  test('a retry that recovers within the policy is accepted', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/retry?attempts=3&fail=2&delay=150');
    const { session, analysis } = await apiQa.stop();

    expect(
      session.requests.filter((request) => request.url.includes('/api/flaky')).map((r) => r.status),
    ).toEqual([503, 503, 200]);
    expectNoFindings(analysis);
  });

  test('an uncontrolled retry loop is reported', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/retry?attempts=5&fail=10&delay=150');
    const { analysis } = await apiQa.stop();

    const loops = findingsOfType(analysis, 'retry-loop');
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ severity: 'high', confidence: 'high' });
    expect(loops[0]?.evidence.measurements).toMatchObject({
      attempts: 5,
      maxAttempts: 3,
      recovered: false,
    });
    expect(findingsOfType(analysis, 'duplicate-request')).toEqual([]);
  });

  test('retries without backoff are reported', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/retry?attempts=2&fail=1&delay=0');
    const { analysis } = await apiQa.stop();

    expect(findingsOfType(analysis, 'retry-loop')[0]?.reasoning).toContain(
      'the policy requires at least 100 ms',
    );
  });
});

test.describe('7. excessive polling', () => {
  test.use({ rules: 'polling' });

  test('polling five times faster than configured is reported', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/polling?interval=200&count=6');
    const { analysis } = await apiQa.stop();

    const polling = findingsOfType(analysis, 'excessive-polling');
    expect(polling).toHaveLength(1);
    expect(polling[0]).toMatchObject({
      ruleId: 'status-poll',
      severity: 'high',
      confidence: 'high',
    });
    // Polled requests are judged by the polling policy, not as duplicates.
    expect(findingsOfType(analysis, 'duplicate-request')).toEqual([]);
  });

  test('polling at the configured interval is accepted', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/polling?interval=1000&count=3');
    const { analysis } = await apiQa.stop();

    expectNoFindings(analysis);
  });
});
