import { posix } from 'node:path';

/**
 * Supply-chain policy for pnpm-lock.yaml:
 * - lockfile format 9 (pnpm 9 and 10);
 * - every package resolved from the npm registry with an sha512 integrity hash;
 * - no tarball URLs, git repositories or local directories as package sources;
 * - workspace links stay inside apps/ and packages/.
 */
export function checkLockfile(text: string): string[] {
  const issues: string[] = [];
  const lines = text.split(/\r?\n/);

  if (!/^lockfileVersion: '9\.0'$/m.test(text)) {
    issues.push("lockfileVersion must be '9.0'");
  }

  const start = lines.indexOf('packages:');
  const end = lines.indexOf('snapshots:');
  if (start === -1) {
    issues.push('no packages section');
    return issues;
  }
  const section = lines.slice(start + 1, end === -1 ? undefined : end);
  let current: string | null = null;
  let hasIntegrity = false;
  const finish = (): void => {
    if (current !== null && !hasIntegrity) {
      issues.push(`${current}: no sha512 integrity hash`);
    }
  };
  for (const line of section) {
    const entry = /^ {2}(\S.*):$/.exec(line);
    if (entry !== null) {
      finish();
      current = (entry[1] ?? '').replace(/^'|'$/g, '');
      hasIntegrity = false;
      continue;
    }
    if (current === null) {
      continue;
    }
    if (/^ {4}resolution:/.test(line)) {
      hasIntegrity = /\{integrity: sha512-[A-Za-z0-9+/]+={0,2}\}/.test(line);
      if (/tarball:|directory:|repo:|commit:|type: git/.test(line)) {
        issues.push(`${current}: resolved from a non-registry source`);
      }
    }
  }
  finish();

  let importer = '.';
  for (const [index, line] of lines.entries()) {
    if (/\b(?:git\+|github:|gitlab:|bitbucket:|file:)/.test(line) || /https?:\/\//.test(line)) {
      issues.push(`line ${String(index + 1)}: URL, git or file source: ${line.trim()}`);
    }
    // Importer keys (`  packages/core:`) appear only in the importers section, before `packages:`.
    const importerKey =
      start !== -1 && index < start ? /^ {2}([^\s'][^:]*):$/.exec(line)?.[1] : undefined;
    if (importerKey !== undefined) {
      importer = importerKey;
    }
    const link = /version: link:(\S+)/.exec(line)?.[1];
    if (link !== undefined) {
      const target = posix.normalize(posix.join(importer, link));
      if (!/^(?:apps|packages)\/[a-z0-9-]+$/.test(target)) {
        issues.push(
          `line ${String(index + 1)}: workspace link outside apps/ or packages/: ${target}`,
        );
      }
    }
  }
  return issues;
}

/** The only registry the project may install from. */
export function checkNpmrc(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:@[^:]+:)?registry\s*=/.test(line))
    .filter((line) => !/=\s*https:\/\/registry\.npmjs\.org\/?\s*$/.test(line))
    .map((line) => `.npmrc points at another registry: ${line.trim()}`);
}
