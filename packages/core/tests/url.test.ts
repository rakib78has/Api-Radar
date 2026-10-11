import { LIMITS } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import {
  classifySegment,
  createSensitiveNameMatcher,
  parseRequestUrl,
  type ParsedRequestUrl,
} from '../src/index.js';

const isSensitive = createSensitiveNameMatcher([]);

function parse(raw: string): ParsedRequestUrl {
  const result = parseRequestUrl(raw, isSensitive);
  if (!result.ok) {
    throw new Error(`Rejected: ${result.reason}`);
  }
  return result.value;
}

describe('classifySegment', () => {
  it.each([
    ['', 'literal'],
    ['users', 'literal'],
    ['v1', 'literal'],
    ['2024-01-31', 'literal'],
    ['this-is-a-very-long-lowercase-article-slug-2024', 'literal'],
    ['42', 'id'],
    ['507f1f77bcf86cd799439011', 'id'],
    ['deadbeefdeadbeef', 'literal'],
    ['550e8400-e29b-41d4-a716-446655440000', 'uuid'],
    ['550E8400-E29B-41D4-A716-446655440000', 'uuid'],
    ['d41d8cd98f00b204e9800998ecf8427e', 'token'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'token'],
    ['aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z', 'token'],
    ['jane@example.com', 'email'],
    ['jane%40example.com', 'email'],
  ])('classifies %j as %s', (segment, kind) => {
    expect(classifySegment(segment)).toBe(kind);
  });
});

describe('parseRequestUrl', () => {
  it('keeps origin and path, and drops credentials and the fragment', () => {
    const parsed = parse('https://user:secret@App.Test:443/api/items#section');
    expect(parsed.origin).toBe('https://app.test');
    expect(parsed.path).toBe('/api/items');
    expect(parsed.sanitizedUrl).toBe('https://app.test/api/items');
    expect(parsed.sanitizedUrl).not.toContain('secret');
  });

  it('keeps non-default ports', () => {
    expect(parse('http://localhost:3000/x').origin).toBe('http://localhost:3000');
  });

  it('templates ids and redacts tokens and e-mail addresses from the stored path', () => {
    const parsed = parse(
      'https://app.test/users/42/files/550e8400-e29b-41d4-a716-446655440000/share/d41d8cd98f00b204e9800998ecf8427e/to/jane@example.com',
    );
    expect(parsed.path).toBe(
      '/users/42/files/550e8400-e29b-41d4-a716-446655440000/share/:token/to/:email',
    );
    expect(parsed.template).toBe('/users/:id/files/:uuid/share/:token/to/:email');
  });

  it('redacts sensitive query values in the display URL and keeps order', () => {
    const parsed = parse('https://app.test/x?b=2&access_token=abc123&a=1&API-Key=k&flag');
    expect(parsed.sanitizedUrl).toBe(
      'https://app.test/x?b=2&access_token=[REDACTED]&a=1&API-Key=[REDACTED]&flag',
    );
    expect(parsed.query.map((param) => param.sensitive)).toEqual([false, true, false, true, false]);
  });

  it('decodes query components and survives malformed percent-encoding', () => {
    const parsed = parse('https://app.test/x?q=a+b%20c&bad=%E0%A4%A&%zz=1');
    expect(parsed.query).toEqual([
      { name: 'q', value: 'a b c', sensitive: false },
      { name: 'bad', value: '%E0%A4%A', sensitive: false },
      { name: '%zz', value: '1', sensitive: false },
    ]);
  });

  it('applies extra sensitive names', () => {
    const custom = parseRequestUrl(
      'https://app.test/x?tenant=acme',
      createSensitiveNameMatcher(['Tenant']),
    );
    expect(custom.ok && custom.value.sanitizedUrl).toBe('https://app.test/x?tenant=[REDACTED]');
  });

  it.each([
    ['not a url', 'invalid-url'],
    ['/relative/path', 'invalid-url'],
    ['ftp://files.test/x', 'unsupported-scheme'],
    ['data:text/plain,hi', 'unsupported-scheme'],
    ['chrome-extension://abc/page.html', 'unsupported-scheme'],
    ['javascript:alert(1)', 'unsupported-scheme'],
  ])('rejects %j as %s', (raw, reason) => {
    expect(parseRequestUrl(raw, isSensitive)).toEqual({ ok: false, reason });
  });

  it('rejects URLs longer than the limit', () => {
    const raw = `https://app.test/${'a'.repeat(LIMITS.urlLength)}`;
    expect(parseRequestUrl(raw, isSensitive)).toEqual({ ok: false, reason: 'url-too-long' });
  });

  it('rejects URLs whose sanitised form would exceed the limit', () => {
    // Each `token=1` (7 chars) becomes `token=[REDACTED]` (16 chars).
    const query = Array.from({ length: 2_000 }, () => 'token=1').join('&');
    const raw = `https://app.test/x?${query}`;
    expect(raw.length).toBeLessThanOrEqual(LIMITS.urlLength);
    expect(parseRequestUrl(raw, isSensitive)).toEqual({ ok: false, reason: 'url-too-long' });
  });
});

describe('createSensitiveNameMatcher', () => {
  it.each([
    'password',
    'Password',
    'user_password',
    'access_token',
    'accessToken',
    'X-Amz-Signature',
    'X-Amz-Credential',
    'api_key',
    'x-api-key',
    'key',
    'code',
    'client_secret',
    'sessionid',
    'JSESSIONID',
    'cookie',
    'cvv',
  ])('treats %j as sensitive', (name) => {
    expect(isSensitive(name)).toBe(true);
  });

  it.each(['id', 'page', 'monkey', 'author', 'zipcode', 'sort', 'q', '__proto__', 'constructor'])(
    'treats %j as not sensitive',
    (name) => {
      expect(isSensitive(name)).toBe(false);
    },
  );

  it('ignores blank extra names', () => {
    expect(createSensitiveNameMatcher(['', '--'])('anything')).toBe(false);
  });
});
