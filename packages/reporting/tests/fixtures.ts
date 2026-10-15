import type { CaptureSession, Finding, RegressionResult } from '@api-qa/contracts';

import type { ReportableAnalysis } from '../src/index.js';

/** Text a hostile page could put into a URL, title or measurement. */
export const HOSTILE = `<script>alert("x")</script><img src=x onerror=alert(1)>'&`;

export function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'duplicate-request:0123456789abcdef',
    type: 'duplicate-request',
    ruleId: 'duplicate-request',
    severity: 'high',
    confidence: 'high',
    title: 'POST request sent 2 times',
    reasoning: '2 equivalent requests from the same page within 40 ms.',
    endpoint: 'POST https://shop.test/api/orders',
    evidence: {
      requestIds: ['r1', 'r2'],
      requestCount: 2,
      firstTimestamp: Date.UTC(2026, 9, 15, 9, 0, 0),
      lastTimestamp: Date.UTC(2026, 9, 15, 9, 0, 0, 40),
      measurements: {
        copies: 2,
        recovered: false,
        lastError: null,
        url: 'https://shop.test/api/orders',
      },
    },
    ...overrides,
  };
}

export function session(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    schemaVersion: 1,
    id: 'session-1',
    name: 'Checkout run',
    source: 'extension-webrequest',
    startedAt: Date.UTC(2026, 9, 15, 8, 59, 0),
    endedAt: Date.UTC(2026, 9, 15, 9, 5, 0),
    requests: [],
    navigations: [],
    droppedRequestCount: 1,
    triage: { 'duplicate-request:0123456789abcdef': 'confirmed' },
    ...overrides,
  };
}

export function analysis(findings: Finding[] = [finding()]): ReportableAnalysis {
  return {
    ruleSetName: 'Checkout flow',
    findings,
    endpointStats: [
      {
        endpoint: 'POST https://shop.test/api/orders',
        requestCount: 2,
        failureCount: 0,
        timedRequestCount: 2,
        durationP50Ms: 40,
        durationP95Ms: 52.4,
      },
    ],
  };
}

export function regression(passed: boolean): RegressionResult {
  return {
    baselineName: 'Checkout v1',
    passed,
    comparedEndpointCount: 3,
    findings: passed
      ? []
      : [
          finding({
            id: 'regression-new-finding:0123456789abcdef',
            type: 'regression-new-finding',
            ruleId: 'regression',
          }),
        ],
    sessionId: 'session-1',
  };
}
