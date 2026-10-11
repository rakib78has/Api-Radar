import type { CapturedRequest } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { analyzeRequests, median } from '../src/index.js';
import { ORIGIN, requestsAt, ruleSet } from './fixtures.js';

const pollEvery = (expectedIntervalMs: number, tolerance = 0.2) =>
  ruleSet({
    polling: [
      {
        id: 'status-poll',
        match: { method: 'GET', path: '/api/status' },
        expectedIntervalMs,
        tolerance,
      },
    ],
  });

const polls = (timestamps: readonly number[]): CapturedRequest[] =>
  requestsAt(timestamps, { url: `${ORIGIN}/api/status` }, 'p');

const analyse = (requests: CapturedRequest[], rules = pollEvery(1_000)) =>
  analyzeRequests({ requests, navigations: [] }, rules).findings;

const everyMs = (interval: number, count: number) =>
  Array.from({ length: count }, (_, i) => i * interval);

describe('median', () => {
  it('returns the lower middle value and 0 for no values', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([])).toBe(0);
  });
});

describe('excessive polling detection (rule B)', () => {
  it('accepts polling at the expected interval', () => {
    expect(analyse(polls(everyMs(1_000, 6)))).toEqual([]);
  });

  it('accepts polling within tolerance', () => {
    expect(analyse(polls(everyMs(850, 6)))).toEqual([]);
  });

  it('reports polling faster than the policy allows', () => {
    const findings = analyse(polls(everyMs(500, 6)));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'excessive-polling',
      ruleId: 'status-poll',
      severity: 'medium',
      confidence: 'high',
    });
    expect(findings[0]?.evidence.measurements).toMatchObject({
      medianIntervalMs: 500,
      expectedIntervalMs: 1_000,
      intervalCount: 5,
    });
  });

  it('rates polling at least four times too fast as high', () => {
    expect(analyse(polls(everyMs(200, 6)))[0]?.severity).toBe('high');
  });

  it('bases confidence on how many intervals were observed', () => {
    expect(analyse(polls(everyMs(200, 2)))[0]?.confidence).toBe('low');
    expect(analyse(polls(everyMs(200, 3)))[0]?.confidence).toBe('medium');
    expect(analyse(polls(everyMs(200, 2)))[0]?.reasoning).toContain('Only one interval');
  });

  it('ignores one-off timer jitter', () => {
    expect(analyse(polls([0, 1_000, 1_050, 2_050, 3_050, 4_050]))).toEqual([]);
  });

  it('excludes polled requests from duplicate detection', () => {
    // 900 ms polling would otherwise be a duplicate chain under the 1000 ms window.
    expect(analyse(polls(everyMs(900, 5)))).toEqual([]);
  });

  it('does not report unconfigured endpoints as polling', () => {
    const requests = requestsAt(everyMs(5_000, 5), { url: `${ORIGIN}/api/other` });
    expect(analyse(requests)).toEqual([]);
  });

  it('checks each tab separately', () => {
    const tabOne = requestsAt([0, 1_000], { url: `${ORIGIN}/api/status` }, 'a');
    const tabTwo = requestsAt(
      [500, 1_500],
      { url: `${ORIGIN}/api/status`, context: { tabId: 2 } },
      'b',
    );
    expect(analyse([...tabOne, ...tabTwo])).toEqual([]);
  });

  it('gives a request to the first matching policy only', () => {
    const rules = ruleSet({
      polling: [
        { id: 'first', match: { path: '/api/status' }, expectedIntervalMs: 100 },
        { id: 'second', match: { path: '/api/**' }, expectedIntervalMs: 10_000 },
      ],
    });
    expect(analyse(polls(everyMs(500, 4)), rules)).toEqual([]);
  });
});
