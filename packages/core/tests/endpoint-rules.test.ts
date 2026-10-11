import type { CapturedRequest, DetectionRuleSetInput } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { analyzeRequests } from '../src/index.js';
import { ORIGIN, request, ruleSet } from './fixtures.js';

type Endpoints = NonNullable<DetectionRuleSetInput['endpoints']>;

const call = (id: string, path: string, timestamp = 0, method = 'GET'): CapturedRequest =>
  request({ id, timestamp, method, url: `${ORIGIN}${path}` });

const analyse = (
  requests: CapturedRequest[],
  endpoints: Endpoints,
  extra: Partial<DetectionRuleSetInput> = {},
  droppedRequestCount = 0,
) =>
  analyzeRequests(
    { requests, navigations: [], droppedRequestCount },
    ruleSet({ endpoints, ...extra }),
  ).findings;

describe('endpoint rules (rule D)', () => {
  it('reports calls to a forbidden endpoint', () => {
    const findings = analyse(
      [call('a', '/api/admin/reset'), call('b', '/api/items', 10)],
      [{ id: 'no-admin', match: { path: '/api/admin/**' }, forbidden: true }],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'forbidden-endpoint',
      ruleId: 'no-admin',
      severity: 'high',
      endpoint: `GET ${ORIGIN}/api/admin/reset`,
      evidence: { requestIds: ['a'] },
    });
  });

  it('matches the method when the rule names one', () => {
    const rules: Endpoints = [
      { id: 'no-delete', match: { method: 'DELETE', path: '/api/items' }, forbidden: true },
    ];
    expect(analyse([call('a', '/api/items')], rules)).toEqual([]);
    expect(analyse([call('a', '/api/items', 0, 'DELETE')], rules)).toHaveLength(1);
  });

  it('reports a required endpoint that was never called', () => {
    const findings = analyse(
      [call('a', '/api/items')],
      [{ id: 'needs-cart', match: { path: '/api/cart' }, required: true, expectedCount: 1 }],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'missing-required-endpoint',
      confidence: 'high',
      endpoint: null,
      evidence: { requestCount: 0 },
    });
  });

  it('lowers confidence in a missing call when the capture dropped requests', () => {
    const findings = analyse(
      [],
      [{ id: 'needs-cart', match: { path: '/api/cart' }, required: true }],
      {},
      3,
    );
    expect(findings[0]?.confidence).toBe('medium');
    expect(findings[0]?.reasoning).toContain('dropped 3 request(s)');
  });

  it('reports a call count above or below the exact expectation', () => {
    const rule: Endpoints = [
      { id: 'one-profile', match: { path: '/api/profile' }, expectedCount: 1 },
    ];
    const twice = analyse([call('a', '/api/profile'), call('b', '/api/profile', 5_000)], rule);
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ type: 'unexpected-call-count', severity: 'medium' });
    expect(twice[0]?.evidence.measurements).toMatchObject({ calls: 2, expected: 'exactly 1' });

    const never = analyse([], rule);
    expect(never[0]).toMatchObject({ type: 'unexpected-call-count', severity: 'high' });

    expect(analyse([call('a', '/api/profile')], rule)).toEqual([]);
  });

  it('reports counts outside a minimum and maximum', () => {
    const rule: Endpoints = [
      { id: 'search', match: { path: '/api/search' }, minCount: 2, maxCount: 3 },
    ];
    const times = (n: number) =>
      Array.from({ length: n }, (_, i) => call(`s${String(i)}`, '/api/search', i * 5_000));
    expect(analyse(times(1), rule)[0]?.evidence.measurements.expected).toBe('at least 2');
    expect(analyse(times(2), rule)).toEqual([]);
    expect(analyse(times(3), rule)).toEqual([]);
    expect(analyse(times(4), rule)[0]?.evidence.measurements.expected).toBe('at most 3');
  });

  it('counts a retried operation once', () => {
    const rule: Endpoints = [{ id: 'save', match: { path: '/api/save' }, expectedCount: 1 }];
    const requests = [
      request({ id: 'a', url: `${ORIGIN}/api/save`, status: 503 }),
      request({ id: 'b', url: `${ORIGIN}/api/save`, timestamp: 1_500, status: 200 }),
    ];
    expect(analyse(requests, rule)).toEqual([]);
  });

  it('removes excluded endpoints from every detector', () => {
    const rule: Endpoints = [
      { id: 'telemetry', match: { path: '/api/telemetry' }, excluded: true },
    ];
    const requests = [call('a', '/api/telemetry', 0), call('b', '/api/telemetry', 10)];
    const result = analyzeRequests({ requests, navigations: [] }, ruleSet({ endpoints: rule }));
    expect(result.findings).toEqual([]);
    expect(result.skippedRequestCount).toBe(2);
  });

  describe('strict endpoint mode', () => {
    const rules: Endpoints = [{ id: 'items', match: { path: '/api/items' } }];

    it('reports API calls no rule or polling policy covers', () => {
      const findings = analyse(
        [call('a', '/api/items'), call('b', '/api/surprise', 5_000), call('c', '/api/poll', 9_000)],
        rules,
        {
          strictEndpoints: true,
          polling: [{ id: 'poll', match: { path: '/api/poll' }, expectedIntervalMs: 1_000 }],
        },
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        type: 'unexpected-endpoint',
        severity: 'low',
        endpoint: `GET ${ORIGIN}/api/surprise`,
      });
    });

    it('is off by default', () => {
      expect(analyse([call('b', '/api/surprise')], rules)).toEqual([]);
    });
  });
});
