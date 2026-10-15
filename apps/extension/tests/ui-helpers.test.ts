import { FINDING_TYPES, type CapturedRequest, type Finding } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import {
  httpOrigin,
  isHttpOrigin,
  matchPatternFor,
  parseOriginList,
} from '../src/shared/origins.js';
import {
  ALL_FINDINGS,
  ALL_REQUESTS,
  filterFindings,
  filterRequests,
  groupFindingsByType,
  optionOrAll,
  statusClassOf,
  triageOf,
  typeLabel,
} from '../src/ui/filters.js';

function finding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    type: 'duplicate-request',
    ruleId: 'duplicate-request',
    severity: 'low',
    confidence: 'high',
    title: `Finding ${id}`,
    reasoning: '',
    endpoint: 'GET https://shop.test/api/cart',
    evidence: {
      requestIds: [],
      requestCount: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      measurements: {},
    },
    ...overrides,
  };
}

function request(id: string, overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    id,
    timestamp: 0,
    source: 'extension-webrequest',
    method: 'GET',
    origin: 'https://shop.test',
    path: '/api/cart',
    url: 'https://shop.test/api/cart',
    resourceType: 'api',
    status: 200,
    error: null,
    durationMs: 1,
    initiator: null,
    context: { tabId: 1, frameId: 0, documentId: null },
    fingerprint: {
      endpoint: 'GET https://shop.test/api/cart',
      requestKey: '0123456789abcdef',
      bodyHash: null,
      bodyStatus: 'absent',
    },
    ...overrides,
  };
}

describe('origins', () => {
  it.each([
    ['https://shop.test/a?b#c', 'https://shop.test'],
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['chrome://extensions', null],
    ['file:///C:/x', null],
    ['not a url', null],
    [undefined, null],
  ])('httpOrigin(%j) is %j', (url, expected) => {
    expect(httpOrigin(url)).toBe(expected);
  });

  it('accepts only exact origins', () => {
    expect(isHttpOrigin('https://shop.test')).toBe(true);
    expect(isHttpOrigin('https://shop.test/')).toBe(false);
    expect(isHttpOrigin('https://user@shop.test')).toBe(false);
  });

  it('builds host match patterns without ports', () => {
    expect(matchPatternFor('http://127.0.0.1:4321')).toBe('http://127.0.0.1/*');
    expect(matchPatternFor('https://api.shop.test')).toBe('https://api.shop.test/*');
  });

  it('parses a free-text origin list', () => {
    expect(parseOriginList(' https://a.test/x, https://a.test\nftp://b.test  junk ')).toEqual({
      origins: ['https://a.test'],
      invalid: ['ftp://b.test', 'junk'],
    });
    expect(parseOriginList('')).toEqual({ origins: [], invalid: [] });
  });
});

describe('finding filters', () => {
  const findings = [
    finding('a'),
    finding('b', {
      type: 'retry-loop',
      severity: 'high',
      endpoint: 'POST https://shop.test/api/pay',
    }),
    finding('c', { endpoint: null, title: 'Required endpoint /api/cart was never called' }),
  ];
  const triage = { b: 'confirmed' } as const;

  it('filters by type, severity, triage and text', () => {
    const ids = (filter: Partial<typeof ALL_FINDINGS>) =>
      filterFindings(findings, triage, { ...ALL_FINDINGS, ...filter }).map((f) => f.id);
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ type: 'retry-loop' })).toEqual(['b']);
    expect(ids({ severity: 'low' })).toEqual(['a', 'c']);
    expect(ids({ triage: 'confirmed' })).toEqual(['b']);
    expect(ids({ triage: 'open' })).toEqual(['a', 'c']);
    expect(ids({ text: ' /API/PAY ' })).toEqual(['b']);
    expect(ids({ text: 'never called' })).toEqual(['c']);
  });

  it('groups by type in canonical order', () => {
    expect(
      groupFindingsByType(findings).map((group) => [group.type, group.findings.length]),
    ).toEqual([
      ['duplicate-request', 2],
      ['retry-loop', 1],
    ]);
    expect(FINDING_TYPES[0]).toBe('duplicate-request');
  });

  it('defaults triage to open and labels types', () => {
    expect(triageOf(finding('z'), {})).toBe('open');
    expect(typeLabel('request-after-navigation')).toBe('Request after navigation');
  });
});

describe('request filters', () => {
  it.each([
    [{ status: 204 }, '2xx'],
    [{ status: 304 }, '3xx'],
    [{ status: 404 }, '4xx'],
    [{ status: 503 }, '5xx'],
    [{ status: null }, 'unknown'],
    [{ status: 0 }, 'unknown'],
    [{ status: 700 }, 'unknown'],
    [{ status: null, error: 'net::ERR_FAILED' }, 'error'],
  ] as const)('classifies %j as %s', (overrides, expected) => {
    expect(statusClassOf(request('x', overrides))).toBe(expected);
  });

  it('filters by method, status class and URL text', () => {
    const requests = [
      request('a'),
      request('b', { method: 'POST', status: 500, url: 'https://shop.test/api/pay' }),
    ];
    const ids = (filter: Partial<typeof ALL_REQUESTS>) =>
      filterRequests(requests, { ...ALL_REQUESTS, ...filter }).map((r) => r.id);
    expect(ids({})).toEqual(['a', 'b']);
    expect(ids({ method: 'POST' })).toEqual(['b']);
    expect(ids({ status: '2xx' })).toEqual(['a']);
    expect(ids({ text: 'PAY' })).toEqual(['b']);
  });

  it('maps select values without casting', () => {
    expect(optionOrAll('POST', ['GET', 'POST'] as const)).toBe('POST');
    expect(optionOrAll('<script>', ['GET', 'POST'] as const)).toBe('all');
  });
});
