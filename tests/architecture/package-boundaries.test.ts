import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const packagesDir = join(repoRoot, 'packages');

/**
 * Every shared package and the only external modules its sources may import.
 * Anything else (chrome, react, playwright, node:*, another workspace) is a violation.
 * Adding a package under packages/ without listing it here fails the suite.
 */
const ALLOWED_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  contracts: ['zod'],
  core: ['@api-qa/contracts'],
};

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

function importSpecifiers(file: string): string[] {
  const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  return info.importedFiles.map((ref) => ref.fileName);
}

function isAllowedExternal(specifier: string, allowed: readonly string[]): boolean {
  return allowed.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function keysOf(value: unknown): string[] {
  return typeof value === 'object' && value !== null ? Object.keys(value) : [];
}

/** Names from `dependencies` and `peerDependencies`; dev dependencies never ship. */
function declaredRuntimeDependencies(packageName: string): string[] {
  const manifestPath = join(packagesDir, packageName, 'package.json');
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest !== 'object' || manifest === null) {
    throw new TypeError(`${relative(repoRoot, manifestPath)} is not a JSON object`);
  }
  return [
    ...keysOf('dependencies' in manifest ? manifest.dependencies : undefined),
    ...keysOf('peerDependencies' in manifest ? manifest.peerDependencies : undefined),
  ];
}

const packageNames = Object.keys(ALLOWED_IMPORTS);

describe('shared package boundaries', () => {
  it('declares an import allowlist for every package under packages/', () => {
    const onDisk = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(onDisk).toEqual([...packageNames].sort());
  });

  describe.each(packageNames)('packages/%s', (packageName) => {
    const allowed = ALLOWED_IMPORTS[packageName] ?? [];
    const srcDir = join(packagesDir, packageName, 'src');

    it('imports only allowlisted modules and files inside its own src/', () => {
      const files = listTypeScriptFiles(srcDir);
      expect(files.length).toBeGreaterThan(0);

      const violations = files.flatMap((file) =>
        importSpecifiers(file)
          .filter((specifier) => {
            if (specifier.startsWith('.')) {
              const target = resolve(dirname(file), specifier);
              return !target.startsWith(srcDir + sep);
            }
            return !isAllowedExternal(specifier, allowed);
          })
          .map((specifier) => `${relative(repoRoot, file)} imports "${specifier}"`),
      );

      expect(violations).toEqual([]);
    });

    it('declares only allowlisted runtime dependencies', () => {
      const declared = declaredRuntimeDependencies(packageName);
      expect(declared.filter((name) => !allowed.includes(name))).toEqual([]);
    });
  });
});
