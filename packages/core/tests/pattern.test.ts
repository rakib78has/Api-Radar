import { describe, expect, it } from 'vitest';

import { compileEndpointPattern, wildcardMatch } from '../src/index.js';

describe('wildcardMatch', () => {
  it.each([
    ['', '', true],
    ['*', '', true],
    ['*', 'anything', true],
    ['abc', 'abc', true],
    ['abc', 'abd', false],
    ['a*c', 'abbbc', true],
    ['a*c', 'ab', false],
    ['*.json', 'data.json', true],
    ['*.json', 'data.jsonx', false],
    ['a**b', 'ab', true],
    ['*a*b*', 'xxaxxbxx', true],
    ['abc', 'ab', false],
    ['ab', 'abc', false],
  ])('wildcardMatch(%j, %j) is %s', (pattern, text, expected) => {
    expect(wildcardMatch(pattern, text)).toBe(expected);
  });

  it('handles adversarial input in linear-ish time', () => {
    // A backtracking regex would take exponential time on this.
    expect(wildcardMatch('*a*a*a*a*a*a*a*a*b', 'a'.repeat(5_000))).toBe(false);
  });
});

describe('compileEndpointPattern', () => {
  const origin = 'https://app.test';

  it.each([
    ['/api/users', '/api/users', true],
    ['/api/users', '/api/users/', false],
    ['/api/users', '/api/users/1', false],
    ['/api/users/:id', '/api/users/42', true],
    ['/api/users/:id', '/api/users/:token', true],
    ['/api/users/:id', '/api/users/', false],
    ['/api/users/:id', '/api/users/42/posts', false],
    ['/api/*/items', '/api/v2/items', true],
    ['/api/v*', '/api/v2', true],
    ['/api/**', '/api', true],
    ['/api/**', '/api/a/b/c', true],
    ['/api/**/items', '/api/items', true],
    ['/api/**/items', '/api/a/b/items', true],
    ['/api/**/items', '/api/a/b/other', false],
    ['/**', '/', true],
    ['/', '/', true],
    ['/', '/x', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(compileEndpointPattern(pattern)(origin, path)).toBe(expected);
  });

  it('matches the origin when the pattern has one', () => {
    const matches = compileEndpointPattern('https://api.example.com/v1/**');
    expect(matches('https://api.example.com', '/v1/users')).toBe(true);
    expect(matches('https://other.example.com', '/v1/users')).toBe(false);
    expect(matches('http://api.example.com', '/v1/users')).toBe(false);
  });

  it('normalises the pattern origin like the URL parser (case, default port)', () => {
    const matches = compileEndpointPattern('HTTPS://API.Example.com:443/v1');
    expect(matches('https://api.example.com', '/v1')).toBe(true);
  });

  it('supports wildcards in the host', () => {
    const matches = compileEndpointPattern('https://*.example.com/**');
    expect(matches('https://eu.example.com', '/x')).toBe(true);
    expect(matches('https://example.org', '/x')).toBe(false);
  });

  it('treats an origin-only pattern as the root path', () => {
    const matches = compileEndpointPattern('https://api.example.com');
    expect(matches('https://api.example.com', '/')).toBe(true);
    expect(matches('https://api.example.com', '/x')).toBe(false);
  });

  it('copes with many ** segments against a long path', () => {
    const matches = compileEndpointPattern('/**/**/a/**/**/b/**/c/**/**/d');
    const path = `/${Array.from({ length: 2_000 }, () => 'x').join('/')}/a/b/c/e`;
    expect(matches(origin, path)).toBe(false);
  });
});
