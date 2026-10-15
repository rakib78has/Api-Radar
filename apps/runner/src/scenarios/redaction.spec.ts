import { readFileSync } from 'node:fs';

import { TEST_APP_ORIGIN, expect, test } from '../fixtures/api-qa.js';

const SECRETS = ['RUNNER-SECRET-1', 'RUNNER-SECRET-2', 'RunnerSecret3', 'RUNNER-SECRET-4'];

test.describe('12. sensitive-data redaction', () => {
  test('secrets in queries, bodies, paths and route URLs never reach the session or reports', async ({
    apiQa,
  }) => {
    await apiQa.start();
    await apiQa.runScenario('/s/redaction');
    const result = await apiQa.stop();
    const files = await apiQa.report(result);

    const outputs = {
      session: JSON.stringify(result.session),
      analysis: JSON.stringify(result.analysis),
      json: readFileSync(files.json, 'utf8'),
      html: readFileSync(files.html, 'utf8'),
      findingsCsv: readFileSync(files.findingsCsv, 'utf8'),
      endpointsCsv: readFileSync(files.endpointsCsv, 'utf8'),
    };
    for (const [name, text] of Object.entries(outputs)) {
      for (const secret of SECRETS) {
        expect(text.includes(secret), `${name} contains ${secret}`).toBe(false);
      }
    }

    const urls = result.session.requests.map((request) => request.url);
    expect(urls).toContain(`${TEST_APP_ORIGIN}/api/search?q=shoes&access_token=[REDACTED]`);
    expect(urls).toContain(`${TEST_APP_ORIGIN}/api/reset/:token`);
    expect(result.session.navigations.map((navigation) => navigation.url)).toContain(
      `${TEST_APP_ORIGIN}/s/redaction?session=[REDACTED]`,
    );
    // The login body was fingerprinted, not stored.
    const login = result.session.requests.find((request) => request.url.endsWith('/api/login'));
    expect(login?.fingerprint).toMatchObject({ bodyStatus: 'captured' });
    expect(login?.fingerprint.bodyHash).toMatch(/^[0-9a-f]{16}$/);
  });
});
