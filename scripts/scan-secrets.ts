// Scans every tracked and unignored file for credential-shaped strings.
// Usage: node scripts/scan-secrets.ts
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

import { isScannable, scanText, type SecretFinding } from './lib/secrets.ts';

const MAX_BYTES = 2 * 1024 * 1024;

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((file) => file.length > 0 && isScannable(file));

const findings: SecretFinding[] = [];
let scanned = 0;
for (const file of files) {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    continue; // deleted in the working tree
  }
  if (size > MAX_BYTES) {
    continue;
  }
  findings.push(...scanText(file, readFileSync(file, 'utf8')));
  scanned++;
}

if (findings.length > 0) {
  process.stderr.write(`Possible secrets found in ${String(findings.length)} place(s):\n`);
  for (const finding of findings) {
    process.stderr.write(
      `  ${finding.file}:${String(finding.line)}  ${finding.rule}  ${finding.preview}\n`,
    );
  }
  process.stderr.write(
    'Remove and rotate real credentials. For a deliberate fake, add "secret-scan: allow" to the line.\n',
  );
  process.exit(1);
}
process.stdout.write(`No secrets found in ${String(scanned)} files.\n`);
