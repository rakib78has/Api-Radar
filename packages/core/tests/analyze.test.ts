import { findingSchema, type CapturedRequest } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { SEVERITY_RANK, analyzeRequests, computeEndpointStats, percentile } from '../src/index.js';
import { ORIGIN, navigation, request, requestsAt, ruleSet } from './fixtures.js';

/** A capture that triggers every built-in detector at least once. */
function busyCapture(): CapturedRequest[] {
  return [
    ...requestsAt([0, 40], { url: `${ORIGIN}/api/cart`, method: 'POST' }, 'dup'),
    ...requestsAt([100, 200, 300, 400, 500], { url: `${ORIGIN}/api/pay`, status: 502 }, 'retry'),
    ...requestsAt([0, 200, 400, 600, 800], { url: `${ORIGIN}/api/status` }, 'poll'),
    request({ id: 'late', timestamp: 9_000, url: `${ORIGIN}/api/feed` }),
    request({ id: 'admin', timestamp: 50, url: `${ORIGIN}/api/admin` }),
    request({ id: 'img', timestamp: 60, url: `${ORIGIN}/logo.png`, resourceType: 'image' }),
  ];
}

const RULES = ruleSet({
  polling: [{ id: 'status', match: { path: '/api/status' }, expectedIntervalMs: 1_000 }],
  endpoints: [{ id: 'no-admin', match: { path: '/api/admin' }, forbidden: true }],
});
const NAVIGATIONS = [navigation('n1', 0, 'doc-1'), navigation('n2', 5_000, 'doc-2')];

/** Deterministic Fisher-Yates shuffle. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy;
}

describe('analyzeRequests', () => {
  const result = analyzeRequests({ requests: busyCapture(), navigations: NAVIGATIONS }, RULES);

  it('runs every detector', () => {
    expect(new Set(result.findings.map((finding) => finding.type))).toEqual(
      new Set([
        'duplicate-request',
        'retry-loop',
        'excessive-polling',
        'request-after-navigation',
        'forbidden-endpoint',
      ]),
    );
  });

  it('produces findings that satisfy the contract schema', () => {
    for (const finding of result.findings) {
      expect(findingSchema.parse(finding)).toEqual(finding);
    }
  });

  it('sorts findings by severity', () => {
    const ranks = result.findings.map((finding) => SEVERITY_RANK[finding.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('gives identical output for any input order', () => {
    for (const seed of [1, 2, 3, 42, 1_000]) {
      const again = analyzeRequests(
        { requests: shuffled(busyCapture(), seed), navigations: shuffled(NAVIGATIONS, seed) },
        RULES,
      );
      expect(again).toEqual(result);
    }
  });

  it('analyses only the configured resource types, plus unknown ones', () => {
    expect(result.skippedRequestCount).toBe(1);
    expect(result.analysedRequestCount).toBe(busyCapture().length - 1);
    const withUnknown = analyzeRequests(
      { requests: requestsAt([0, 10], { resourceType: null }), navigations: [] },
      ruleSet(),
    );
    expect(withUnknown.findings).toHaveLength(1);
  });

  it('can analyse other resource types when configured', () => {
    const images = requestsAt([0, 10], { url: `${ORIGIN}/logo.png`, resourceType: 'image' });
    expect(analyzeRequests({ requests: images, navigations: [] }).findings).toEqual([]);
    expect(
      analyzeRequests({ requests: images, navigations: [] }, ruleSet({ resourceTypes: ['image'] }))
        .findings,
    ).toHaveLength(1);
  });

  it('reports the rule set it used', () => {
    expect(result.ruleSetName).toBe('Test rules');
    expect(analyzeRequests({ requests: [], navigations: [] }).ruleSetName).toBe('Default');
  });
});

describe('computeEndpointStats', () => {
  it('counts requests, failures and duration percentiles per endpoint', () => {
    const stats = computeEndpointStats([
      ...[10, 20, 30, 40].map((durationMs, i) =>
        request({ id: `a${String(i)}`, durationMs, status: i === 0 ? 500 : 200 }),
      ),
      request({ id: 'b', url: `${ORIGIN}/api/a-first`, durationMs: null }),
    ]);
    expect(stats).toEqual([
      {
        endpoint: `GET ${ORIGIN}/api/a-first`,
        requestCount: 1,
        failureCount: 0,
        timedRequestCount: 0,
        durationP50Ms: null,
        durationP95Ms: null,
      },
      {
        endpoint: `GET ${ORIGIN}/api/items`,
        requestCount: 4,
        failureCount: 1,
        timedRequestCount: 4,
        durationP50Ms: 20,
        durationP95Ms: 40,
      },
    ]);
  });
});

describe('percentile', () => {
  it('uses nearest rank', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
    expect(percentile([1, 2, 3], 0)).toBe(1);
  });
});
