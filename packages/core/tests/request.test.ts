import { DEFAULT_RULE_SET, capturedRequestSchema } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { normalizeNavigation, normalizeRequest, normalizeResourceType } from '../src/index.js';
import { ORIGIN, rawRequest, request } from './fixtures.js';

describe('normalizeRequest', () => {
  it('produces a record that satisfies the contract schema', () => {
    const result = normalizeRequest(rawRequest({ method: ' post ', status: 201 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(capturedRequestSchema.parse(result.request)).toEqual(result.request);
      expect(result.request.method).toBe('POST');
      expect(result.request.fingerprint.endpoint).toBe(`POST ${ORIGIN}/api/items`);
      expect(result.request.resourceType).toBe('api');
      expect(result.request.initiator).toBe(ORIGIN);
    }
  });

  it.each([
    [{ timestamp: Number.NaN }, 'invalid-timestamp'],
    [{ timestamp: -1 }, 'invalid-timestamp'],
    [{ timestamp: Number.POSITIVE_INFINITY }, 'invalid-timestamp'],
    [{ method: 'FETCH' }, 'unsupported-method'],
    [{ url: 'nonsense' }, 'invalid-url'],
    [{ url: 'wss://app.test/socket' }, 'unsupported-scheme'],
  ] as const)('rejects %j with %s', (overrides, reason) => {
    expect(normalizeRequest(rawRequest(overrides))).toEqual({ ok: false, reason });
  });

  it('rejects requests whose endpoint template would exceed the URL limit', () => {
    const url = `${ORIGIN}${'/1'.repeat(8_000)}`;
    expect(normalizeRequest(rawRequest({ url }))).toEqual({ ok: false, reason: 'url-too-long' });
  });

  describe('requestKey', () => {
    const keyOf = (overrides: Parameters<typeof rawRequest>[0]): string =>
      request(overrides).fingerprint.requestKey;

    it('ignores query order and the fragment', () => {
      expect(keyOf({ url: `${ORIGIN}/x?a=1&b=2#one` })).toBe(keyOf({ url: `${ORIGIN}/x?b=2&a=1` }));
    });

    it('distinguishes query values, paths, resource ids and methods', () => {
      const base = keyOf({ url: `${ORIGIN}/users/1?page=1` });
      expect(keyOf({ url: `${ORIGIN}/users/1?page=2` })).not.toBe(base);
      expect(keyOf({ url: `${ORIGIN}/users/2?page=1` })).not.toBe(base);
      expect(keyOf({ url: `${ORIGIN}/users/1?page=1`, method: 'HEAD' })).not.toBe(base);
      expect(keyOf({ url: `https://other.test/users/1?page=1` })).not.toBe(base);
    });

    it('distinguishes a bare flag from an empty value', () => {
      expect(keyOf({ url: `${ORIGIN}/x?flag` })).not.toBe(keyOf({ url: `${ORIGIN}/x?flag=` }));
    });

    it('drops configured ignored parameters', () => {
      const options = { ...DEFAULT_RULE_SET.normalization, ignoredQueryParams: ['_'] };
      expect(request({ url: `${ORIGIN}/x?a=1&_=111` }, options).fingerprint.requestKey).toBe(
        request({ url: `${ORIGIN}/x?a=1&_=222` }, options).fingerprint.requestKey,
      );
    });

    it('uses only the presence of sensitive parameters', () => {
      expect(keyOf({ url: `${ORIGIN}/x?token=one` })).toBe(keyOf({ url: `${ORIGIN}/x?token=two` }));
      expect(keyOf({ url: `${ORIGIN}/x?token=one` })).not.toBe(keyOf({ url: `${ORIGIN}/x` }));
    });

    it('includes the body fingerprint', () => {
      const json = (text: string) => ({
        method: 'POST',
        body: { kind: 'text' as const, text, contentType: 'application/json' },
      });
      expect(keyOf(json('{"a":1,"b":2}'))).toBe(keyOf(json('{"b":2,"a":1}')));
      expect(keyOf(json('{"a":1}'))).not.toBe(keyOf(json('{"a":2}')));
      expect(keyOf({ method: 'POST', body: { kind: 'unavailable' } })).not.toBe(
        keyOf({ method: 'POST', body: { kind: 'absent' } }),
      );
    });

    it('separates truncated bodies of different lengths', () => {
      const options = { ...DEFAULT_RULE_SET.normalization, maxBodyLength: 1_024 };
      const big = (length: number) =>
        request(
          {
            method: 'POST',
            body: { kind: 'text', text: 'x'.repeat(length), contentType: null },
          },
          options,
        ).fingerprint;
      expect(big(2_000).bodyStatus).toBe('truncated');
      expect(big(2_000).requestKey).toBe(big(2_000).requestKey);
      expect(big(2_000).requestKey).not.toBe(big(2_001).requestKey);
    });
  });

  it('keeps unavailable fields as null', () => {
    const captured = request({
      status: null,
      durationMs: null,
      initiator: null,
      resourceType: null,
      context: { tabId: null, frameId: null, documentId: null },
    });
    expect(captured).toMatchObject({
      status: null,
      durationMs: null,
      initiator: null,
      resourceType: null,
      context: { tabId: null, frameId: null, documentId: null },
    });
  });

  it('reduces the initiator to an http(s) origin', () => {
    expect(request({ initiator: 'https://app.test/page?session=1' }).initiator).toBe(ORIGIN);
    expect(request({ initiator: 'null' }).initiator).toBeNull();
    expect(request({ initiator: 'chrome-extension://abc' }).initiator).toBeNull();
  });

  it('removes URLs from error messages and caps their length', () => {
    const captured = request({
      status: null,
      error: 'net::ERR_FAILED at https://app.test/x?token=secret ' + 'y'.repeat(5_000),
    });
    expect(captured.error).toMatch(/^net::ERR_FAILED at \[URL\] y+$/);
    expect(captured.error).not.toContain('secret');
    expect(captured.error?.length).toBe(2_000);
  });
});

describe('normalizeResourceType', () => {
  it.each([
    ['xmlhttprequest', 'api'],
    ['XHR', 'api'],
    ['fetch', 'api'],
    ['main_frame', 'document'],
    ['ping', 'beacon'],
    ['Image', 'image'],
    ['websocket', 'websocket'],
    ['something-new', 'other'],
    ['__proto__', 'other'],
    ['constructor', 'other'],
  ])('maps %j to %s', (raw, expected) => {
    expect(normalizeResourceType(raw)).toBe(expected);
  });

  it('keeps an unknown resource type as null', () => {
    expect(normalizeResourceType(null)).toBeNull();
  });
});

describe('normalizeNavigation', () => {
  const raw = (url: string, timestamp = 5) => ({
    id: 'n1',
    timestamp,
    url,
    context: { tabId: 1, frameId: 0, documentId: 'doc-2' },
  });

  it('sanitises http(s) navigation URLs', () => {
    const result = normalizeNavigation(raw('https://app.test/reset?token=abc#x'));
    expect(result).toEqual({
      ok: true,
      navigation: {
        id: 'n1',
        timestamp: 5,
        url: 'https://app.test/reset?token=[REDACTED]',
        context: { tabId: 1, frameId: 0, documentId: 'doc-2' },
      },
    });
  });

  it('records non-http documents by scheme only', () => {
    const result = normalizeNavigation(raw('chrome://newtab/?q=private'));
    expect(result.ok && result.navigation.url).toBe('chrome:');
  });

  it('rejects invalid URLs and timestamps', () => {
    expect(normalizeNavigation(raw('::'))).toEqual({ ok: false, reason: 'invalid-url' });
    expect(normalizeNavigation(raw(ORIGIN, -5))).toEqual({
      ok: false,
      reason: 'invalid-timestamp',
    });
  });
});
