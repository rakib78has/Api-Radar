import {
  baselineSchema,
  regressionResultSchema,
  type Baseline,
  type CapturedRequest,
} from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import {
  analyzeRequests,
  compareWithBaseline,
  createBaseline,
  type AnalysisResult,
} from '../src/index.js';
import { ORIGIN, request, ruleSet } from './fixtures.js';

const ITEMS = `GET ${ORIGIN}/api/items`;

/** `count` successful requests to `path`, 5 s apart so they are never duplicates. */
function calls(
  path: string,
  count: number,
  overrides: Parameters<typeof request>[0] = {},
  prefix = path,
): CapturedRequest[] {
  return Array.from({ length: count }, (_, i) =>
    request({
      id: `${prefix.replace(/\W/g, '')}${String(i)}`,
      timestamp: i * 5_000,
      url: `${ORIGIN}${path}`,
      ...overrides,
    }),
  );
}

const analyse = (requests: CapturedRequest[]): AnalysisResult =>
  analyzeRequests({ requests, navigations: [] }, ruleSet());

const baselineOf = (requests: CapturedRequest[]): Baseline =>
  createBaseline(analyse(requests), { name: 'Checkout v1', createdAt: 1_700_000_000_000 });

const compare = (requests: CapturedRequest[], baseline: Baseline, rules = ruleSet()) =>
  compareWithBaseline(
    analyzeRequests({ requests, navigations: [] }, rules),
    baseline,
    rules,
    'run-2',
  );

describe('createBaseline', () => {
  it('produces a valid baseline with endpoint stats and finding keys', () => {
    const baseline = baselineOf([
      ...calls('/api/items', 2),
      ...calls('/api/dup', 2, {}, 'd').map((r, i) => ({ ...r, timestamp: i })),
    ]);
    expect(baselineSchema.parse(baseline)).toEqual(baseline);
    expect(baseline.endpoints.map((stats) => stats.endpoint)).toEqual([
      `GET ${ORIGIN}/api/dup`,
      ITEMS,
    ]);
    expect(baseline.findingKeys).toEqual([
      { type: 'duplicate-request', endpoint: `GET ${ORIGIN}/api/dup` },
    ]);
    expect(baseline.ruleSetName).toBe('Test rules');
  });
});

describe('compareWithBaseline (rule E)', () => {
  const baseline = baselineOf(calls('/api/items', 4));

  it('passes when nothing changed', () => {
    const result = compare(calls('/api/items', 4), baseline);
    expect(result).toEqual({
      baselineName: 'Checkout v1',
      passed: true,
      comparedEndpointCount: 1,
      findings: [],
      sessionId: 'run-2',
    });
  });

  it('reports an increased request count', () => {
    const result = compare(calls('/api/items', 5), baseline);
    expect(result.passed).toBe(false);
    expect(result.findings[0]).toMatchObject({
      type: 'regression-request-count',
      severity: 'medium',
      endpoint: ITEMS,
    });
    expect(result.findings[0]?.evidence.measurements).toMatchObject({
      baselineCount: 4,
      currentCount: 5,
      allowedCount: 4,
    });
    expect(compare(calls('/api/items', 8), baseline).findings[0]?.severity).toBe('high');
  });

  it('applies absolute and relative count tolerances', () => {
    expect(
      compare(
        calls('/api/items', 5),
        baseline,
        ruleSet({ regression: { countToleranceAbsolute: 1 } }),
      ).passed,
    ).toBe(true);
    expect(
      compare(
        calls('/api/items', 6),
        baseline,
        ruleSet({ regression: { countToleranceRatio: 0.5 } }),
      ).passed,
    ).toBe(true);
  });

  it('reports a higher failure rate', () => {
    const current = calls('/api/items', 4).map((call, i) =>
      i < 2 ? { ...call, status: 500 } : call,
    );
    const finding = compare(current, baseline).findings.find(
      (candidate) => candidate.type === 'regression-failure-rate',
    );
    expect(finding).toMatchObject({ severity: 'high', confidence: 'medium' });
    expect(finding?.evidence.measurements).toMatchObject({
      baselineFailureRate: 0,
      currentFailureRate: 0.5,
    });
  });

  it('reports slower p95 durations, with low confidence on small samples', () => {
    const slow = calls('/api/items', 4, { durationMs: 100 });
    const finding = compare(slow, baseline).findings[0];
    expect(finding).toMatchObject({ type: 'regression-duration', confidence: 'low' });

    const bigBaseline = baselineOf(calls('/api/items', 6));
    const bigSlow = calls('/api/items', 6, { durationMs: 100 });
    expect(compare(bigSlow, bigBaseline).findings[0]?.confidence).toBe('medium');
  });

  it('skips timing comparison when either side has no timing', () => {
    const untimed = calls('/api/items', 4, { durationMs: null });
    expect(compare(untimed, baseline).passed).toBe(true);
    expect(compare(calls('/api/items', 4, { durationMs: 900 }), baselineOf(untimed)).passed).toBe(
      true,
    );
  });

  it('reports new and missing endpoints', () => {
    const result = compare(calls('/api/other', 1), baseline);
    expect(result.findings.map((finding) => finding.type).sort()).toEqual([
      'regression-missing-endpoint',
      'regression-new-endpoint',
    ]);
    expect(result.comparedEndpointCount).toBe(2);
    const quiet = ruleSet({ regression: { reportMissingEndpoints: false } });
    expect(compare(calls('/api/other', 1), baseline, quiet).findings.map((f) => f.type)).toEqual([
      'regression-new-endpoint',
    ]);
  });

  it('reports findings that the baseline did not have, but not known ones', () => {
    const duplicated = [
      ...calls('/api/items', 4),
      request({ id: 'copy', timestamp: 10, url: `${ORIGIN}/api/items` }),
    ];
    const fresh = compare(duplicated, baselineOf(calls('/api/items', 5)));
    const newFinding = fresh.findings.find((finding) => finding.type === 'regression-new-finding');
    expect(newFinding).toMatchObject({ endpoint: ITEMS, severity: 'low' });
    expect(newFinding?.title).toContain('duplicate-request');

    const known = compare(duplicated, baselineOf(duplicated));
    expect(known.passed).toBe(true);
  });

  it('produces a result that satisfies the contract schema', () => {
    const result = compare([...calls('/api/other', 2), ...calls('/api/items', 9)], baseline);
    expect(regressionResultSchema.parse(result)).toEqual(result);
  });

  it('treats an endpoint with zero baseline requests safely', () => {
    const zero: Baseline = {
      ...baseline,
      endpoints: [
        {
          endpoint: ITEMS,
          requestCount: 0,
          failureCount: 0,
          timedRequestCount: 0,
          durationP50Ms: null,
          durationP95Ms: null,
        },
      ],
    };
    const result = compare(calls('/api/items', 1), zero);
    expect(result.findings[0]).toMatchObject({
      type: 'regression-request-count',
      severity: 'medium',
    });
  });
});
