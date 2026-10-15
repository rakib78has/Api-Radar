import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_RULE_SET,
  parseSanitizedReport,
  type RawRequestObservation,
} from '@api-qa/contracts';
import { analyzeRequests, compareWithBaseline } from '@api-qa/core';
import { describe, expect, it } from 'vitest';

import { buildSession } from '../src/capture/session.js';
import {
  expectNoFindings,
  expectNoRegressions,
  findingsOfType,
} from '../src/fixtures/assertions.js';
import { BaselineError, BaselineStore } from '../src/fixtures/baselines.js';
import { writeReports } from '../src/reporters/report-writer.js';

const ORIGIN = 'http://127.0.0.1:47130';

function raw(
  id: string,
  timestamp: number,
  overrides: Partial<RawRequestObservation> = {},
): RawRequestObservation {
  return {
    id,
    timestamp,
    source: 'playwright',
    method: 'GET',
    url: `${ORIGIN}/api/cart`,
    resourceType: 'Fetch',
    status: 200,
    error: null,
    durationMs: 5,
    initiator: ORIGIN,
    context: { tabId: 1, frameId: 0, documentId: 'L1' },
    body: { kind: 'absent' },
    ...overrides,
  };
}

const META = { id: 'run-1', name: 'Run', startedAt: 1_000, endedAt: 2_000 };

describe('buildSession', () => {
  it('normalises, redacts and counts rejected observations', () => {
    const session = buildSession(
      {
        requests: [
          raw('a', 1_100, { url: `${ORIGIN}/api/cart?token=s3cret` }),
          raw('b', 1_200, { method: 'BREW' }),
        ],
        navigations: [
          {
            id: 'n1',
            timestamp: 1_000,
            url: `${ORIGIN}/?session=abc`,
            context: { tabId: 1, frameId: 0, documentId: 'L1' },
          },
          {
            id: 'n2',
            timestamp: 1_001,
            url: 'nonsense',
            context: { tabId: 1, frameId: 0, documentId: 'L1' },
          },
        ],
      },
      DEFAULT_RULE_SET,
      META,
    );
    expect(session.requests.map((request) => request.url)).toEqual([
      `${ORIGIN}/api/cart?token=[REDACTED]`,
    ]);
    expect(session.droppedRequestCount).toBe(1);
    expect(session.navigations.map((navigation) => navigation.url)).toEqual([
      `${ORIGIN}/?session=[REDACTED]`,
    ]);
    expect(session).toMatchObject({
      source: 'playwright',
      startedAt: 1_000,
      endedAt: 2_000,
      triage: {},
    });
  });

  it('never records an end before the start, and rejects invalid metadata', () => {
    expect(
      buildSession({ requests: [], navigations: [] }, DEFAULT_RULE_SET, { ...META, endedAt: 1 })
        .endedAt,
    ).toBe(1_000);
    expect(() =>
      buildSession({ requests: [], navigations: [] }, DEFAULT_RULE_SET, { ...META, id: 'bad id' }),
    ).toThrow('Captured session is invalid');
  });
});

describe('assertions', () => {
  const session = buildSession(
    { requests: [raw('a', 1_100), raw('b', 1_150)], navigations: [] },
    DEFAULT_RULE_SET,
    META,
  );
  const analysis = analyzeRequests(session);

  it('lists findings at or above the severity threshold', () => {
    expect(findingsOfType(analysis, 'duplicate-request')).toHaveLength(1);
    expect(() => {
      expectNoFindings(analysis);
    }).toThrow(
      /found 1:\n {2}- \[low\/high\] duplicate-request: GET request sent 2 times\n {6}GET http/,
    );
    expect(() => {
      expectNoFindings(analysis, 'medium');
    }).not.toThrow();
  });

  it('passes a run without regressions and lists regressions otherwise', () => {
    const baseline = {
      schemaVersion: 1 as const,
      name: 'b',
      createdAt: 0,
      ruleSetName: 'Default',
      endpoints: [],
      findingKeys: [],
    };
    const regressed = compareWithBaseline(analysis, baseline);
    expect(() => {
      expectNoRegressions(regressed);
    }).toThrow(/regressed against baseline "b"/);
    expect(() => {
      expectNoRegressions({ ...regressed, passed: true, findings: [] });
    }).not.toThrow();
  });

  it('formats findings without an endpoint', () => {
    const missing = analyzeRequests(
      { requests: [], navigations: [] },
      {
        ...DEFAULT_RULE_SET,
        endpoints: [
          {
            id: 'need',
            description: '',
            match: { method: '*', path: '/x' },
            required: true,
            forbidden: false,
            expectedCount: null,
            minCount: null,
            maxCount: null,
            excluded: false,
            maxRetryAttempts: null,
          },
        ],
      },
    );
    expect(() => {
      expectNoFindings(missing);
    }).toThrow(/missing-required-endpoint: Required endpoint ANY \/x was never called$/);
  });
});

describe('BaselineStore', () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-qa-baselines-'));
  const store = new BaselineStore(directory);
  const session = buildSession(
    { requests: [raw('a', 1_100)], navigations: [] },
    DEFAULT_RULE_SET,
    META,
  );

  it('saves and loads a validated baseline', () => {
    expect(store.exists('cart')).toBe(false);
    const saved = store.save('cart', analyzeRequests(session), 42);
    expect(store.exists('cart')).toBe(true);
    expect(store.load('cart')).toEqual(saved);
    expect(saved).toMatchObject({ name: 'cart', createdAt: 42, ruleSetName: 'Default' });
  });

  it('rejects unsafe names, missing files and corrupt files', () => {
    expect(() => store.pathOf('../escape')).toThrow(BaselineError);
    expect(() => store.pathOf('UPPER')).toThrow(/Invalid baseline name/);
    expect(() => store.load('absent')).toThrow(/does not exist/);
    writeFileSync(store.pathOf('corrupt'), '{"schemaVersion":1}');
    try {
      store.load('corrupt');
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BaselineError);
      expect((error as BaselineError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe('writeReports', () => {
  it('writes every format from a validated report', () => {
    const directory = mkdtempSync(join(tmpdir(), 'api-qa-reports-'));
    const session = buildSession(
      { requests: [raw('a', 1_100), raw('b', 1_150)], navigations: [] },
      DEFAULT_RULE_SET,
      META,
    );
    const files = writeReports({
      session,
      analysis: analyzeRequests(session),
      regression: null,
      directory,
      toolVersion: '0.1.0',
      generatedAt: 0,
    });
    expect(parseSanitizedReport(readFileSync(files.json, 'utf8')).ok).toBe(true);
    expect(readFileSync(files.html, 'utf8')).toContain('GET request sent 2 times');
    expect(readFileSync(files.findingsCsv, 'utf8')).toContain('"duplicate-request"');
    expect(readFileSync(files.endpointsCsv, 'utf8')).toContain(`"GET ${ORIGIN}/api/cart",2,0,2`);
    expect(files.report.session.requestCount).toBe(2);
  });

  it('refuses to write an invalid report', () => {
    const session = buildSession({ requests: [], navigations: [] }, DEFAULT_RULE_SET, META);
    expect(() =>
      writeReports({
        session,
        analysis: analyzeRequests(session),
        regression: null,
        directory: mkdtempSync(join(tmpdir(), 'api-qa-reports-')),
        toolVersion: 'not-semver',
        generatedAt: 0,
      }),
    ).toThrow('Could not build the report');
  });
});
