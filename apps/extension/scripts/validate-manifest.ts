// Validates a built extension: `node scripts/validate-manifest.ts <dist dir> [--e2e]`.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { E2E_HOST_PERMISSIONS } from './build-options.ts';
import { findRemoteCode, validateManifest } from './manifest-policy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const [distArgument = 'dist', ...flags] = process.argv.slice(2);
const dist = join(root, distArgument);
const e2e = flags.includes('--e2e');

const files = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/'));

const packageJson: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const expectedVersion =
  typeof packageJson === 'object' && packageJson !== null && 'version' in packageJson
    ? String(packageJson.version)
    : '';

const manifest: unknown = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const issues = [
  ...validateManifest(manifest, {
    expectedVersion,
    files: new Set(files),
    allowedHostPermissions: e2e ? E2E_HOST_PERMISSIONS : [],
  }),
  ...files
    .filter((file) => file.endsWith('.js') || file.endsWith('.html'))
    .flatMap((file) => findRemoteCode(file, readFileSync(join(dist, file), 'utf8'))),
];

if (issues.length > 0) {
  console.error(`Manifest validation failed for ${distArgument}:`);
  for (const issue of issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}
console.log(
  `Manifest valid: ${distArgument} (${String(files.length)} files, version ${expectedVersion}).`,
);
