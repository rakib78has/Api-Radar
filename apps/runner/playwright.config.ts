import { defineConfig } from '@playwright/test';

import { TEST_APP_ORIGIN } from './src/fixtures/test-app.js';

const ci = process.env.CI === 'true';

export default defineConfig({
  testDir: 'src/scenarios',
  // The controlled test app runs in its own process so a busy runner never delays it.
  webServer: {
    command: 'node src/fixtures/serve-test-app.ts',
    url: `${TEST_APP_ORIGIN}/s/idle`,
    reuseExistingServer: !ci,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 15_000,
  },
  // Measured: one worker runs the suite fastest here (17.9 s vs 20.1 s with three), because
  // several Chromium instances starting at once stall each other's first requests.
  workers: 1,
  fullyParallel: false,
  // Tests are deterministic; a retry would hide flakiness instead of fixing it.
  retries: 0,
  forbidOnly: ci,
  timeout: 30_000,
  outputDir: '../../test-results/runner',
  reporter: [
    ['list'],
    ['junit', { outputFile: '../../reports/runner/junit.xml' }],
    ['html', { open: 'never', outputFolder: '../../reports/runner/html' }],
  ],
  use: {
    // CDP capture requires Chromium; "chromium" selects the full browser in new headless mode.
    browserName: 'chromium',
    channel: 'chromium',
    trace: 'retain-on-failure',
  },
});
