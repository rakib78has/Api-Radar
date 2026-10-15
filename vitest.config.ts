import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Tests run against package sources, so `pnpm test` never depends on a stale dist/ build.
  resolve: {
    alias: {
      '@api-qa/contracts': fromRoot('./packages/contracts/src/index.ts'),
      '@api-qa/core': fromRoot('./packages/core/src/index.ts'),
      '@api-qa/storage': fromRoot('./packages/storage/src/index.ts'),
      '@api-qa/reporting': fromRoot('./packages/reporting/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['packages/*/tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'architecture', include: ['tests/architecture/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'extension', include: ['apps/extension/tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'runner', include: ['apps/runner/tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'security', include: ['tests/security/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'tooling', include: ['tests/tooling/**/*.test.ts'] },
      },
    ],
    coverage: {
      provider: 'v8',
      include: [
        'packages/*/src/**/*.ts',
        'apps/extension/src/**/*.{ts,tsx}',
        'apps/runner/src/**/*.ts',
      ],
      exclude: [
        // Chrome wiring and React views are exercised by the Playwright extension suite.
        'apps/extension/src/background/service-worker.ts',
        'apps/extension/src/shared/{chrome-store,client,zod-config}.ts',
        'apps/extension/src/{popup,panel}/**',
        // Playwright glue, the test app and scenarios run in the Playwright suite (pnpm test:regression).
        'apps/runner/src/capture/recorder.ts',
        'apps/runner/src/fixtures/{api-qa,serve-test-app,test-app}.ts',
        'apps/runner/src/scenarios/**',
      ],
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        // Detection engine: 90% gate (see docs/testing-strategy.md).
        'packages/core/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        // Other critical business logic: 80% gate.
        'packages/contracts/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'packages/storage/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'packages/reporting/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'apps/extension/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'apps/runner/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'scripts/lib/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
