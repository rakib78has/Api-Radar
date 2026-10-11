import { describe, expect, it } from 'vitest';

import {
  LIMITS,
  parseBaseline,
  parseCaptureSession,
  parseJsonDocument,
  parseRuleSet,
  parseSanitizedReport,
} from '../src/index.js';

describe('parseJsonDocument', () => {
  it('parses valid JSON', () => {
    expect(parseJsonDocument('{"a":[1,2]}')).toEqual({ ok: true, value: { a: [1, 2] } });
  });

  it('does not echo file content in syntax errors', () => {
    const result = parseJsonDocument('{"password": "hunter2", oops}');
    expect(result).toEqual({ ok: false, issues: ['(root): Not valid JSON'] });
  });

  it('rejects documents over the size limit before parsing', () => {
    const result = parseJsonDocument(' '.repeat(LIMITS.jsonDocumentLength + 1));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]).toContain('exceeds');
  });
});

describe('parseRuleSet', () => {
  it('accepts JSON text', () => {
    const result = parseRuleSet('{"schemaVersion":1,"name":"From text"}');
    expect(result.ok && result.value.name).toBe('From text');
  });

  it('accepts an already-parsed value', () => {
    expect(parseRuleSet({ schemaVersion: 1, name: 'Object' }).ok).toBe(true);
  });

  it('reports the failing path without the offending value', () => {
    const result = parseRuleSet({
      schemaVersion: 1,
      name: 'x',
      duplicates: { windowMs: 'super-secret-value' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatch(/^duplicates\.windowMs: /);
      expect(result.issues.join('\n')).not.toContain('super-secret-value');
    }
  });

  it('labels root-level problems', () => {
    const result = parseRuleSet(42);
    expect(!result.ok && result.issues[0]).toMatch(/^\(root\): /);
  });

  it('caps the number of reported issues', () => {
    const endpoints = Array.from({ length: 50 }, () => ({ id: '', match: { path: '' } }));
    const result = parseRuleSet({ schemaVersion: 1, name: 'x', endpoints });
    expect(!result.ok && result.issues.length).toBe(20);
  });

  it('returns JSON syntax errors from text input', () => {
    expect(parseRuleSet('{')).toEqual({ ok: false, issues: ['(root): Not valid JSON'] });
  });
});

describe('parseBaseline', () => {
  const stats = {
    endpoint: 'GET https://app.test/api/items',
    requestCount: 4,
    failureCount: 1,
    timedRequestCount: 4,
    durationP50Ms: 12,
    durationP95Ms: 40,
  };
  const baseline = {
    schemaVersion: 1,
    name: 'Checkout',
    createdAt: 1_700_000_000_000,
    ruleSetName: 'Default',
    endpoints: [stats],
    findingKeys: [{ type: 'duplicate-request', endpoint: stats.endpoint }],
  };

  it('accepts a valid baseline', () => {
    expect(parseBaseline(baseline)).toEqual({ ok: true, value: baseline });
  });

  it.each([
    ['duplicate endpoints', { ...baseline, endpoints: [stats, stats] }],
    ['more failures than requests', { ...baseline, endpoints: [{ ...stats, failureCount: 5 }] }],
    ['more timed than total', { ...baseline, endpoints: [{ ...stats, timedRequestCount: 5 }] }],
    ['unknown finding type', { ...baseline, findingKeys: [{ type: 'nope', endpoint: null }] }],
    ['missing field', { ...baseline, endpoints: undefined }],
    ['negative count', { ...baseline, endpoints: [{ ...stats, requestCount: -1 }] }],
    ['NaN duration', { ...baseline, endpoints: [{ ...stats, durationP95Ms: Number.NaN }] }],
    ['extra field', { ...baseline, injected: '<script>' }],
  ])('rejects a baseline with %s', (_label, input) => {
    expect(parseBaseline(input).ok).toBe(false);
  });
});

describe('parseCaptureSession', () => {
  const session = {
    schemaVersion: 1,
    id: 'session-1',
    name: 'Manual run',
    source: 'extension-webrequest',
    startedAt: 1_000,
    endedAt: 2_000,
    requests: [],
    navigations: [],
    droppedRequestCount: 0,
    triage: { 'duplicate-request:0123456789abcdef': 'expected' },
  };

  it('accepts a valid session', () => {
    expect(parseCaptureSession(session).ok).toBe(true);
    expect(parseCaptureSession({ ...session, endedAt: null }).ok).toBe(true);
  });

  it.each([
    ['an end before its start', { ...session, endedAt: 500 }],
    ['an unknown triage status', { ...session, triage: { a: 'maybe' } }],
    ['an unknown capture source', { ...session, source: 'curl' }],
  ])('rejects %s', (_label, input) => {
    expect(parseCaptureSession(input).ok).toBe(false);
  });
});

describe('parseSanitizedReport', () => {
  const report = {
    schemaVersion: 1,
    generatedAt: 5_000,
    tool: { name: 'api-qa-inspector', version: '0.1.0' },
    session: {
      id: 's1',
      name: 'Run',
      source: 'playwright',
      startedAt: 1_000,
      endedAt: 4_000,
      requestCount: 2,
      droppedRequestCount: 0,
    },
    ruleSetName: 'Default',
    findings: [
      {
        id: 'duplicate-request:0123456789abcdef',
        type: 'duplicate-request',
        ruleId: 'duplicate-request',
        severity: 'low',
        confidence: 'high',
        title: 'GET request sent 2 times',
        reasoning: '2 equivalent requests.',
        endpoint: 'GET https://app.test/api/items',
        evidence: {
          requestIds: ['r1', 'r2'],
          requestCount: 2,
          firstTimestamp: 1_000,
          lastTimestamp: 1_200,
          measurements: { copies: 2, recovered: false, url: 'https://app.test/api/items', x: null },
        },
        triage: 'open',
      },
    ],
    endpoints: [],
    regression: null,
  };

  it('accepts a valid report', () => {
    expect(parseSanitizedReport(report).ok).toBe(true);
  });

  it('rejects a report with too many measurements', () => {
    const measurements = Object.fromEntries(
      Array.from({ length: LIMITS.evidenceMeasurements + 1 }, (_, i) => [`m${String(i)}`, i]),
    );
    const [finding] = report.findings;
    const tooMany = {
      ...report,
      findings: [{ ...finding, evidence: { ...finding?.evidence, measurements } }],
    };
    expect(parseSanitizedReport(tooMany).ok).toBe(false);
  });

  it.each([
    ['another tool name', { ...report, tool: { name: 'other', version: '1.0.0' } }],
    ['a non-semver version', { ...report, tool: { name: 'api-qa-inspector', version: 'v1' } }],
  ])('rejects %s', (_label, input) => {
    expect(parseSanitizedReport(input).ok).toBe(false);
  });
});
