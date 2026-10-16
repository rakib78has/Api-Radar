// Removes every generated directory, so the next build and test run start from scratch.
// Usage: pnpm clean
import { existsSync, rmSync } from 'node:fs';

/** Generated output only; sources, node_modules and committed baselines are never touched. */
const GENERATED = [
  'packages/contracts/dist',
  'packages/core/dist',
  'packages/storage/dist',
  'packages/reporting/dist',
  'apps/extension/dist',
  'apps/extension/dist-e2e',
  'coverage',
  'release',
  'reports',
  'test-results',
  'playwright-report',
];

const removed = GENERATED.filter((directory) => existsSync(directory));
for (const directory of removed) {
  rmSync(directory, { recursive: true, force: true });
}
process.stdout.write(
  removed.length === 0 ? 'Nothing to clean.\n' : `Removed ${removed.join(', ')}\n`,
);
