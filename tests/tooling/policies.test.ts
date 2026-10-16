import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { checkLockfile, checkNpmrc } from '../../scripts/lib/lockfile.ts';
import { checkPackageFiles, checksumLines } from '../../scripts/lib/package-policy.ts';
import { checkRelease, releaseNotes, versionFromTag } from '../../scripts/lib/release.ts';
import { entropy, isScannable, mask, scanText } from '../../scripts/lib/secrets.ts';

// Token-shaped values are assembled at runtime so this file never contains one.
const join = (...parts: string[]) => parts.join('');
const TOKENS = {
  'aws-access-key-id': join('AKIA', 'Q7RZ4M2KX9TB6WNE'),
  'github-token': join('ghp_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'),
  'github-fine-grained-token': join('github_pat_', '11ABCDEFG0', 'x'.repeat(10), 'Y7z'.repeat(15)),
  'gitlab-token': join('glpat-', 'Zq8Kd2Lm9Np4Rs7Tu1Vw'),
  'slack-token': join('xoxb-', '1234567890-abcdefABCDEF'),
  'stripe-live-key': join('sk_live_', 'Ab3Cd5Ef7Gh9Ij1Kl3Mn5Op7'),
  'google-api-key': join('AIza', 'Sy9xQ2wE4rT6yU8iO0pA1sD3fG5hJ7kL9zX'),
  'npm-token': join('npm_', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2'),
  'private-key': join('-----BEGIN ', 'RSA PRIVATE KEY-----'),
  'json-web-token': join(
    'eyJhbGciOiJIUzI1NiJ9',
    '.',
    'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
    '.',
    'Sf1KxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  ),
} as const;

describe('scanText', () => {
  it.each(Object.entries(TOKENS))('detects a %s and masks it', (rule, token) => {
    const findings = scanText('src/config.ts', `const value = "${token}";`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'src/config.ts', line: 1, rule });
    expect(findings[0]?.preview).not.toBe(token);
    expect(findings[0]?.preview.includes(token.slice(5, -5))).toBe(false);
  });

  it('flags random-looking values assigned to credential names', () => {
    const value = join('q8Z', 'k2Lm9Np4Rs7Tu1VwX3y');
    expect(scanText('a.ts', `const config = { apiKey: '${value}' };`).map((f) => f.rule)).toEqual([
      'generic-credential-assignment',
    ]);
    expect(scanText('a.env', `CLIENT_SECRET="${value}"`)).toHaveLength(1);
  });

  it.each([
    `password: 'RUNNER-SECRET-2'`,
    `jsonPassword: 'CanaryJsonPassword6'`,
    `apiKey: 'aaaaaaaaaaaaaaaaaaaa'`,
    `token: "short"`,
    `secret = "your-secret-here-please"`,
    `const url = 'https://example.com/?token=[REDACTED]';`,
  ])('ignores placeholders and low-entropy values: %s', (line) => {
    expect(scanText('a.ts', line)).toEqual([]);
  });

  it('honours an explicit allow marker and reports line numbers', () => {
    const token = TOKENS['aws-access-key-id'];
    expect(scanText('a.ts', `x = "${token}"; // secret-scan: allow`)).toEqual([]);
    expect(scanText('a.ts', `ok\n\nx = "${token}"`)[0]?.line).toBe(3);
  });

  it('finds nothing in this repository’s own lockfile and README', () => {
    expect(scanText('README.md', readFileSync('README.md', 'utf8'))).toEqual([]);
  });
});

describe('secret helpers', () => {
  it('measures entropy', () => {
    expect(entropy('aaaa')).toBe(0);
    expect(entropy('abcd')).toBe(2);
  });

  it('masks values', () => {
    expect(mask('short')).toBe('*****');
    expect(mask('ABCDEFGHIJKLMNOP')).toBe('ABCD********MNOP');
  });

  it('skips binaries and the lockfile', () => {
    expect(isScannable('a/icon.png')).toBe(false);
    expect(isScannable('pnpm-lock.yaml')).toBe(false);
    expect(isScannable('src/a.ts')).toBe(true);
  });
});

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      vitest:
        specifier: 5.0.3
        version: 5.0.3

  packages/core:
    dependencies:
      '@api-qa/contracts':
        specifier: workspace:*
        version: link:../contracts

packages:

  vitest@5.0.3:
    resolution: {integrity: sha512-AbCd+/EfGh==}

  '@scope/pkg@1.0.0':
    resolution: {integrity: sha512-XyZ=}
    engines: {node: '>=18'}

snapshots:

  vitest@5.0.3: {}
`;

describe('checkLockfile', () => {
  it('accepts registry packages with integrity hashes and in-repo workspace links', () => {
    expect(checkLockfile(LOCK)).toEqual([]);
    expect(checkLockfile(readFileSync('pnpm-lock.yaml', 'utf8'))).toEqual([]);
  });

  it('rejects missing integrity, tarballs, git sources and escaping links', () => {
    const bad = LOCK.replace('{integrity: sha512-XyZ=}', '{tarball: https://evil.test/p.tgz}')
      .replace(
        '    resolution: {integrity: sha512-AbCd+/EfGh==}',
        '    resolution: {integrity: sha1-abc}',
      )
      .replace('link:../contracts', 'link:../../../outside');
    const issues = checkLockfile(`${bad}\n  x: github:someone/repo\n`);
    expect(issues).toEqual(
      expect.arrayContaining([
        'vitest@5.0.3: no sha512 integrity hash',
        '@scope/pkg@1.0.0: no sha512 integrity hash',
        '@scope/pkg@1.0.0: resolved from a non-registry source',
        expect.stringContaining('workspace link outside apps/ or packages/: ../outside'),
        expect.stringContaining('URL, git or file source'),
      ]),
    );
  });

  it('rejects other lockfile versions and a missing packages section', () => {
    expect(checkLockfile("lockfileVersion: '6.0'\n")).toEqual([
      "lockfileVersion must be '9.0'",
      'no packages section',
    ]);
  });
});

describe('checkNpmrc', () => {
  it('allows only the npm registry', () => {
    expect(checkNpmrc('engine-strict=true\nregistry=https://registry.npmjs.org/\n')).toEqual([]);
    expect(checkNpmrc('registry=https://evil.test/\n@acme:registry=http://x\n')).toHaveLength(2);
  });
});

describe('release checks', () => {
  const changelog =
    '# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-10-15\n\n### Added\n\n- A thing.\n\n## [1.1.0] - 2026-09-01\n\n- Older.\n';

  it('parses only strict semver tags', () => {
    expect(versionFromTag('v1.2.3')).toBe('1.2.3');
    for (const tag of ['1.2.3', 'v1.2', 'v1.2.3-beta', 'v1.2.3;rm -rf /', 'v01.2.3x']) {
      expect(versionFromTag(tag)).toBeNull();
    }
  });

  it('extracts the matching changelog section', () => {
    expect(releaseNotes(changelog, '1.2.0')).toBe('### Added\n\n- A thing.');
    expect(releaseNotes(changelog, '1.1.0')).toBe('- Older.');
    expect(releaseNotes(changelog, '9.9.9')).toBeNull();
    expect(releaseNotes('## [2.0.0] - 2026-01-01\n\n', '2.0.0')).toBeNull();
    // A dot in the version must not match any character.
    expect(releaseNotes('## [1x2x0] - 2026-01-01\n\nNotes', '1.2.0')).toBeNull();
  });

  it('reads the headings release-please writes', () => {
    const generated = [
      '# Changelog',
      '',
      '## [0.2.0](https://github.com/rakib78has/Api-Radar/compare/v0.1.0...v0.2.0) (2026-10-20)',
      '',
      '### Features',
      '',
      '* import HAR files ([#9](https://github.com/rakib78has/Api-Radar/issues/9)) ([abc1234](https://github.com/rakib78has/Api-Radar/commit/abc1234))',
      '',
      '## [0.1.0] - 2026-10-15',
      '',
      '- First release.',
    ].join('\n');
    expect(releaseNotes(generated, '0.2.0')).toMatch(/^### Features\n\n\* import HAR files/);
    expect(releaseNotes(generated, '0.1.0')).toBe('- First release.');
    // A heading without a compare link or date is not a release heading.
    expect(releaseNotes('## [0.2.0]\n\nNotes', '0.2.0')).toBeNull();
    expect(
      releaseNotes('## [0.2.0](javascript:alert(1)) (2026-10-20)\n\nNotes', '0.2.0'),
    ).toBeNull();
  });

  it('accepts a consistent release and lists every inconsistency otherwise', () => {
    const ok = checkRelease({
      tag: 'v1.2.0',
      extensionVersion: '1.2.0',
      rootVersion: '1.2.0',
      changelog,
    });
    expect(ok).toEqual({ issues: [], version: '1.2.0', notes: '### Added\n\n- A thing.' });
    const bad = checkRelease({
      tag: 'v1.3.0',
      extensionVersion: '1.2.0',
      rootVersion: '1.1.0',
      changelog,
    });
    expect(bad.issues).toHaveLength(3);
    expect(
      checkRelease({ tag: 'latest', extensionVersion: '', rootVersion: '', changelog }).issues,
    ).toEqual(['Tag "latest" is not of the form vMAJOR.MINOR.PATCH']);
  });
});

describe('checkPackageFiles', () => {
  const good = [
    'background.js',
    'manifest.json',
    'popup/index.html',
    'panel/index.html',
    'icons/icon-128.png',
    'assets/a.css',
  ];

  it('accepts a production build', () => {
    expect(checkPackageFiles(good)).toEqual([]);
  });

  it('rejects source maps, dotfiles, unexpected types and missing files', () => {
    expect(
      checkPackageFiles([...good, 'assets/a.js.map', '.env', 'assets/.DS_Store', 'notes.md']),
    ).toEqual([
      'assets/a.js.map: source maps must not be packaged',
      '.env: hidden files must not be packaged',
      'assets/.DS_Store: hidden files must not be packaged',
      'notes.md: unexpected file type',
    ]);
    expect(checkPackageFiles(['manifest.json'])).toHaveLength(4);
  });

  it('formats sha256sum-compatible lines', () => {
    expect(checksumLines([{ name: 'a.zip', sha256: 'ab' }])).toBe('ab  a.zip\n');
  });
});
