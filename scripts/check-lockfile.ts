// Enforces the lockfile and registry policy. Usage: node scripts/check-lockfile.ts
import { existsSync, readFileSync } from 'node:fs';

import { checkLockfile, checkNpmrc } from './lib/lockfile.ts';

const issues = [
  ...checkLockfile(readFileSync('pnpm-lock.yaml', 'utf8')),
  ...(existsSync('.npmrc') ? checkNpmrc(readFileSync('.npmrc', 'utf8')) : []),
];

if (issues.length > 0) {
  process.stderr.write(
    `Lockfile policy violations:\n${issues.map((issue) => `  - ${issue}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  'Lockfile policy: every package comes from the npm registry with an sha512 hash.\n',
);
