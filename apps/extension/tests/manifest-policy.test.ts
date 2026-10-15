import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { E2E_HOST_PERMISSIONS } from '../scripts/build-options.ts';
import { findRemoteCode, validateManifest } from '../scripts/manifest-policy.ts';

const source: unknown = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
);
const FILES = new Set(['background.js', 'popup/index.html', 'panel/index.html']);

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = typeof source === 'object' && source !== null ? source : {};
  return { ...base, version: '1.2.3', ...overrides };
}

const validate = (input: unknown, allowedHostPermissions: readonly string[] = []) =>
  validateManifest(input, { expectedVersion: '1.2.3', files: FILES, allowedHostPermissions });

describe('validateManifest', () => {
  it('accepts the shipped manifest', () => {
    expect(validate(manifest())).toEqual([]);
  });

  it('requires the package version', () => {
    expect(validate(manifest({ version: '9.9.9' }))).toEqual([
      'version is 9.9.9, but package.json says 1.2.3',
    ]);
  });

  it.each([
    ['content scripts', { content_scripts: [{ matches: ['<all_urls>'], js: ['x.js'] }] }],
    ['web-accessible resources', { web_accessible_resources: [] }],
    ['externally connectable pages', { externally_connectable: { matches: ['*://*/*'] } }],
  ])('rejects %s', (_label, extra) => {
    expect(validate(manifest(extra))[0]).toMatch(/is not allowed/);
  });

  it('rejects extra or missing permissions', () => {
    expect(
      validate(
        manifest({ permissions: ['activeTab', 'storage', 'webNavigation', 'webRequest', 'tabs'] }),
      ),
    ).toEqual(['permissions must be exactly activeTab, storage, webNavigation, webRequest']);
    expect(validate(manifest({ permissions: ['storage'] }))).toHaveLength(1);
  });

  it('rejects host permissions in production and broad ones anywhere', () => {
    expect(validate(manifest({ host_permissions: ['https://shop.test/*'] }))).toEqual([
      'host_permissions must not be declared; host access is requested at runtime',
    ]);
    expect(validate(manifest({ host_permissions: ['<all_urls>'] }), ['<all_urls>'])).toEqual([
      'host_permissions must not grant access to every site',
    ]);
    expect(validate(manifest({ optional_host_permissions: ['<all_urls>'] }))).toHaveLength(1);
  });

  it('allows exactly the E2E host permission in the E2E build', () => {
    expect(
      validate(manifest({ host_permissions: E2E_HOST_PERMISSIONS }), E2E_HOST_PERMISSIONS),
    ).toEqual([]);
    expect(validate(manifest(), E2E_HOST_PERMISSIONS)).toEqual([
      'host_permissions must be exactly http://127.0.0.1/*',
    ]);
  });

  it.each([
    ["script-src 'self' 'unsafe-eval'; object-src 'none'", 2],
    ["script-src 'self' https://cdn.test; object-src 'none'", 2],
    ["object-src 'none'", 1],
    ["script-src 'self'; object-src 'self'", 1],
    ["script-src 'self'; object-src 'none'; img-src *", 1],
  ])('rejects the CSP %j', (policy, count) => {
    expect(
      validate(manifest({ content_security_policy: { extension_pages: policy } })),
    ).toHaveLength(count);
  });

  it('requires referenced files to exist in the build', () => {
    expect(
      validateManifest(manifest(), { expectedVersion: '1.2.3', files: new Set(['background.js']) }),
    ).toEqual(['popup/index.html is referenced by the manifest but missing from the build']);
  });

  it('rejects malformed manifests', () => {
    expect(validate(manifest({ manifest_version: 2 }))[0]).toMatch(/^manifest_version: /);
    expect(validate(null)[0]).toMatch(/^\(root\): /);
  });
});

describe('findRemoteCode', () => {
  it.each([
    ['a.html', '<script src="https://cdn.test/x.js"></script>', 1],
    ['a.html', '<script src="//cdn.test/x.js"></script>', 1],
    ['a.html', '<script type="module" src="../assets/x.js"></script>', 0],
    ['a.js', 'import("https://cdn.test/x.js")', 1],
    ['a.js', 'import x from "https://cdn.test/x.js"', 1],
    ['a.js', 'importScripts("x.js")', 1],
    ['a.js', 'const u = "https://shop.test/api";', 0],
    ['a.css', '@import url(https://x)', 0],
  ])('%s with %j has %i issue(s)', (file, content, count) => {
    expect(findRemoteCode(file, content)).toHaveLength(count);
  });
});
