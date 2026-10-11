import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Tests run against package sources, so `pnpm test` never depends on a stale dist/ build.
  resolve: {
    alias: {
      '@api-qa/contracts': fromRoot('./packages/contracts/src/index.ts'),
      '@api-qa/core': fromRoot('./packages/core/src/index.ts'),
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
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        // Detection engine: 90% gate (see docs/testing-strategy.md).
        'packages/core/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
        // Other critical business logic: 80% gate.
        'packages/contracts/src/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
