// Validates a release tag and writes its notes. Usage:
//   node scripts/check-release.ts <tag> [notes-output-file]
// The tag may also come from RELEASE_TAG (set by the release workflow).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { checkRelease } from './lib/release.ts';

function versionOf(path: string): string {
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return typeof manifest === 'object' && manifest !== null && 'version' in manifest
    ? String(manifest.version)
    : '';
}

const tag = process.argv[2] ?? process.env.RELEASE_TAG ?? '';
const notesFile = process.argv[3];
const result = checkRelease({
  tag,
  extensionVersion: versionOf('apps/extension/package.json'),
  rootVersion: versionOf('package.json'),
  changelog: readFileSync('CHANGELOG.md', 'utf8'),
});

if (result.issues.length > 0) {
  process.stderr.write(
    `Release ${tag} is not ready:\n${result.issues.map((issue) => `  - ${issue}`).join('\n')}\n`,
  );
  process.exit(1);
}
if (notesFile !== undefined && result.notes !== null) {
  mkdirSync(dirname(notesFile), { recursive: true });
  writeFileSync(notesFile, `${result.notes}\n`);
}
process.stdout.write(`Release ${tag} is consistent (version ${result.version ?? ''}).\n`);
