import { defineConfig } from '@playwright/test';

const ci = process.env.CI === 'true';
/** Milliseconds to pause between browser actions, so headed runs can be followed by eye. */
const slowMo = Number(process.env.API_QA_SLOW_MO ?? '0');

export default defineConfig({
  testDir: 'tests/e2e',
  // The packaged-zip test runs only via pnpm test:package, which builds the archive first.
  ...(process.env.API_QA_PACKAGE_TEST === '1' ? {} : { grepInvert: /@package/ }),
  // One persistent browser with the extension loaded is shared per worker.
  workers: 1,
  fullyParallel: false,
  // Tests are deterministic; a retry would hide flakiness instead of fixing it.
  retries: 0,
  forbidOnly: ci,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // In CI, failures also appear as annotations on the run and pull request.
  reporter: ci
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    ...(slowMo > 0 ? { launchOptions: { slowMo } } : {}),
  },
});
