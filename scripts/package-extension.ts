// Packages the production extension build for manual review and store upload.
// Usage: node scripts/package-extension.ts   (run `pnpm build` first)
// Writes to release/:
//   api-qa-inspector-<version>.zip         deterministic archive of apps/extension/dist
//   api-qa-inspector-<version>.files.txt   SHA-256 of every file inside the archive
//   SHA256SUMS                             SHA-256 of the release artifacts
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { findRemoteCode, validateManifest } from '../apps/extension/scripts/manifest-policy.ts';
import { checkPackageFiles, checksumLines } from './lib/package-policy.ts';
import { createZip } from './lib/zip.ts';

const DIST = 'apps/extension/dist';
const OUT = 'release';

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');
const fail = (issues: readonly string[]): never => {
  process.stderr.write(
    `Cannot package the extension:\n${issues.map((issue) => `  - ${issue}`).join('\n')}\n`,
  );
  process.exit(1);
};

const manifestVersion: unknown = JSON.parse(readFileSync('apps/extension/package.json', 'utf8'));
const version =
  typeof manifestVersion === 'object' && manifestVersion !== null && 'version' in manifestVersion
    ? String(manifestVersion.version)
    : '';

const files = readdirSync(DIST, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(DIST, join(entry.parentPath, entry.name)).split(sep).join('/'))
  .sort();

const manifest: unknown = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const issues = [
  ...checkPackageFiles(files),
  // The production policy: no host_permissions at all.
  ...validateManifest(manifest, { expectedVersion: version, files: new Set(files) }),
  ...files
    .filter((file) => file.endsWith('.js') || file.endsWith('.html'))
    .flatMap((file) => findRemoteCode(file, readFileSync(join(DIST, file), 'utf8'))),
];
if (issues.length > 0) {
  fail(issues);
}

const entries = files.map((path) => ({
  path,
  data: new Uint8Array(readFileSync(join(DIST, path))),
}));
const zip = createZip(entries);
const base = `api-qa-inspector-${version}`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${base}.zip`), zip);
writeFileSync(
  join(OUT, `${base}.files.txt`),
  checksumLines(entries.map((entry) => ({ name: entry.path, sha256: sha256(entry.data) }))),
);
writeFileSync(
  join(OUT, 'SHA256SUMS'),
  checksumLines([
    { name: `${base}.zip`, sha256: sha256(zip) },
    { name: `${base}.files.txt`, sha256: sha256(readFileSync(join(OUT, `${base}.files.txt`))) },
  ]),
);
process.stdout.write(
  `Packaged ${String(files.length)} files into ${OUT}/${base}.zip (${String(zip.length)} bytes)\n` +
    `sha256 ${sha256(zip)}\n`,
);
