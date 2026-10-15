import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseSanitizedReport } from '@api-qa/contracts';

import { expectNoRegressions, findingsOfType } from '../fixtures/assertions.js';
import { BaselineError, BaselineStore } from '../fixtures/baselines.js';
import { TEST_APP_ORIGIN, expect, test } from '../fixtures/api-qa.js';

const CART = `GET ${TEST_APP_ORIGIN}/api/cart`;

test.describe('10. request-count regressions', () => {
  test.use({ rules: 'regression' });

  test('the recorded cart flow matches its baseline @baseline', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/count?n=2');
    const result = await apiQa.stop();

    const regression = apiQa.compare(result, 'cart-flow');
    expectNoRegressions(regression);
    expect(regression.comparedEndpointCount).toBe(1);
  });

  test('more calls than the baseline are a regression', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/count?n=4');
    const result = await apiQa.stop();

    const regression = apiQa.compare(result, 'cart-flow');
    expect(regression.passed).toBe(false);
    expect(regression.findings).toHaveLength(1);
    expect(regression.findings[0]).toMatchObject({
      type: 'regression-request-count',
      severity: 'high',
      endpoint: CART,
    });
    expect(regression.findings[0]?.evidence.measurements).toMatchObject({
      baselineCount: 2,
      currentCount: 4,
    });
  });
});

test.describe('11. invalid baseline files', () => {
  const store = new BaselineStore(
    fileURLToPath(new URL('../../baselines/invalid', import.meta.url)),
  );

  const failureOf = (name: string): BaselineError => {
    try {
      store.load(name);
    } catch (error) {
      if (error instanceof BaselineError) {
        return error;
      }
      throw error;
    }
    throw new Error(`Expected baseline "${name}" to be rejected`);
  };

  test('malformed JSON is rejected without echoing the file', () => {
    expect(failureOf('not-json').issues).toEqual(['(root): Not valid JSON']);
  });

  test('a wrong schema version and field types are rejected', () => {
    const { issues } = failureOf('wrong-schema');
    expect(issues.some((issue) => issue.startsWith('schemaVersion:'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('createdAt:'))).toBe(true);
  });

  test('duplicate endpoints and impossible counts are rejected', () => {
    const { issues } = failureOf('duplicate-endpoints');
    expect(issues.some((issue) => issue.includes('Duplicate endpoint'))).toBe(true);
    expect(
      issues.some((issue) => issue.includes('failureCount must not exceed requestCount')),
    ).toBe(true);
  });

  test('a missing baseline explains how to record it', () => {
    expect(failureOf('missing').message).toContain('pnpm baselines:update');
  });

  test('a baseline name cannot escape the directory', () => {
    expect(() => store.load('../cart-flow')).toThrow(/Invalid baseline name/);
  });
});

test.describe('14. regression report generation', () => {
  test.use({ rules: 'regression' });

  test('a regressed run produces sanitised JSON, HTML and CSV reports', async ({ apiQa }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/count?n=4');
    const result = await apiQa.stop();
    const regression = apiQa.compare(result, 'cart-flow');
    const files = await apiQa.report(result, regression);

    const json = parseSanitizedReport(readFileSync(files.json, 'utf8'));
    expect(json.ok).toBe(true);
    expect(json.ok && json.value.regression?.passed).toBe(false);
    expect(json.ok && json.value.tool).toEqual({ name: 'api-qa-inspector', version: '0.1.0' });

    const html = readFileSync(files.html, 'utf8');
    expect(html).toContain('Regression against “cart-flow”');
    expect(html).toContain('Failed: 1 regression finding(s).');
    expect(html).toContain('Request count rose from 2 to 4');
    expect(html).not.toContain('<script');

    const csv = readFileSync(files.endpointsCsv, 'utf8');
    expect(csv).toContain(`"${CART}",4,0,4`);
    expect(readFileSync(files.findingsCsv, 'utf8').split('\r\n')[0]).toContain(
      '"id","type","severity"',
    );

    // The assertion helper fails the test with a readable summary.
    expect(() => {
      expectNoRegressions(regression);
    }).toThrow(
      /regressed against baseline "cart-flow" \(1 finding\(s\)\):\n {2}- \[high\/high\] regression-request-count/,
    );
    expect(findingsOfType(result.analysis, 'duplicate-request')).toEqual([]);
  });
});
