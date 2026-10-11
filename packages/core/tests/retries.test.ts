import type { CapturedRequest } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { analyzeRequests, isFailure } from '../src/index.js';
import { request, ruleSet } from './fixtures.js';

/** Requests 100 ms apart with the given HTTP statuses (`null` = network error). */
function attempts(statuses: readonly (number | null)[], gapMs = 100): CapturedRequest[] {
  return statuses.map((status, index) =>
    request({
      id: `a${String(index + 1)}`,
      timestamp: 1_000 + index * gapMs,
      status,
      error: status === null ? 'net::ERR_CONNECTION_RESET' : null,
    }),
  );
}

const analyse = (requests: CapturedRequest[], rules = ruleSet()) =>
  analyzeRequests({ requests, navigations: [] }, rules).findings;

describe('isFailure', () => {
  it.each([
    [200, null, false],
    [304, null, false],
    [400, null, true],
    [503, null, true],
    [null, null, false],
    [null, 'net::ERR_FAILED', true],
  ])('status %s, error %s -> %s', (status, error, expected) => {
    expect(isFailure(request({ status, error }))).toBe(expected);
  });
});

describe('retry-loop detection (rule C)', () => {
  it('accepts a retry within policy and does not call it a duplicate', () => {
    expect(analyse(attempts([503, 503, 200]))).toEqual([]);
  });

  it('reports a loop that exceeds the attempt limit and never succeeds', () => {
    const findings = analyse(attempts([503, 503, 503, 503, 503]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'retry-loop',
      severity: 'high',
      confidence: 'high',
      evidence: { requestCount: 5 },
    });
    expect(findings[0]?.evidence.measurements).toMatchObject({
      attempts: 5,
      maxAttempts: 3,
      recovered: false,
      lastStatus: 503,
    });
  });

  it('rates an over-limit loop that eventually succeeded as medium', () => {
    expect(analyse(attempts([500, 500, 500, 200]))[0]).toMatchObject({
      type: 'retry-loop',
      severity: 'medium',
      confidence: 'medium',
    });
  });

  it('treats network errors as failures', () => {
    expect(analyse(attempts([null, null, null, null]))[0]?.evidence.measurements).toMatchObject({
      lastError: 'net::ERR_CONNECTION_RESET',
      lastStatus: null,
    });
  });

  it('reports retries faster than the minimum delay', () => {
    const rules = ruleSet({ retries: { minDelayMs: 500 } });
    const findings = analyse(attempts([503, 200], 50), rules);
    expect(findings[0]).toMatchObject({ type: 'retry-loop', severity: 'medium' });
    expect(findings[0]?.reasoning).toContain('50 ms apart');
  });

  it('lets an endpoint rule allow more attempts', () => {
    const rules = ruleSet({
      endpoints: [{ id: 'flaky', match: { path: '/api/items' }, maxRetryAttempts: 6 }],
    });
    expect(analyse(attempts([503, 503, 503, 503, 503]), rules)).toEqual([]);
  });

  it('does not chain a repeat that follows a success', () => {
    // 200 then 200: a duplicate, not a retry.
    const findings = analyse(attempts([200, 200]));
    expect(findings.map((finding) => finding.type)).toEqual(['duplicate-request']);
  });

  it('starts a new chain when the next attempt is outside the retry window', () => {
    const rules = ruleSet({ retries: { windowMs: 1_000 }, duplicates: { windowMs: 1 } });
    expect(analyse(attempts([503, 503, 503, 503], 2_000), rules)).toEqual([]);
  });

  it('still recognises retries when reporting is disabled', () => {
    const rules = ruleSet({ retries: { enabled: false } });
    expect(analyse(attempts([503, 503, 503, 503, 503]), rules)).toEqual([]);
  });
});
