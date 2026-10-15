import {
  DEFAULT_RULE_SET,
  parseRuleSet,
  type CaptureSession,
  type RawRequestObservation,
} from '@api-qa/contracts';
import {
  analyzeRequests,
  compareWithBaseline,
  createBaseline,
  normalizeNavigation,
  normalizeRequest,
} from '@api-qa/core';
import {
  buildReport,
  endpointsToCsv,
  findingsToCsv,
  reportToHtml,
  reportToJson,
} from '@api-qa/reporting';
import { describe, expect, it } from 'vitest';

import { SHOP, observation } from '../support/capture.js';

/**
 * Unique values planted in every channel a secret can arrive through. None may
 * appear in anything that is persisted or exported.
 */
const CANARIES = {
  userinfoPassword: 'CanaryUserinfoPw1',
  queryToken: 'CanaryQueryToken2',
  queryApiKey: 'CanaryApiKey3',
  signedUrl: 'CanarySignature4',
  pathToken: 'aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP5Canary',
  pathEmail: 'canary.person@example.com',
  fragment: 'CanaryFragment5',
  jsonPassword: 'CanaryJsonPassword6',
  formPassword: 'CanaryFormPassword7',
  errorUrlToken: 'CanaryErrorToken8',
  initiatorPath: 'CanaryInitiatorPath9',
  navigationToken: 'CanaryNavigationToken10',
} as const;

function hostileObservations(): RawRequestObservation[] {
  return [
    observation('userinfo', 100, {
      url: `https://admin:${CANARIES.userinfoPassword}@shop.test/api/cart#${CANARIES.fragment}`,
    }),
    observation('query', 200, {
      url: `${SHOP}/api/search?q=shoes&access_token=${CANARIES.queryToken}&api_key=${CANARIES.queryApiKey}`,
    }),
    observation('signed', 300, {
      url: `${SHOP}/files/report.pdf?X-Amz-Signature=${CANARIES.signedUrl}&X-Amz-Expires=60`,
    }),
    observation('path', 400, {
      url: `${SHOP}/api/reset/${CANARIES.pathToken}/for/${CANARIES.pathEmail}`,
    }),
    observation('json', 500, {
      method: 'POST',
      url: `${SHOP}/api/login`,
      body: {
        kind: 'text',
        text: JSON.stringify({ user: 'jane', password: CANARIES.jsonPassword }),
        contentType: 'application/json',
      },
    }),
    observation('form', 600, {
      method: 'POST',
      url: `${SHOP}/api/login`,
      body: {
        kind: 'text',
        text: `user=jane&password=${CANARIES.formPassword}`,
        contentType: 'application/x-www-form-urlencoded',
      },
    }),
    observation('error', 700, {
      status: null,
      error: `net::ERR_FAILED https://shop.test/api/x?token=${CANARIES.errorUrlToken}`,
    }),
    observation('initiator', 800, {
      initiator: `${SHOP}/account/${CANARIES.initiatorPath}?session=1`,
    }),
  ];
}

function session(): CaptureSession {
  const requests = hostileObservations().flatMap((raw) => {
    const result = normalizeRequest(raw, DEFAULT_RULE_SET.normalization);
    return result.ok ? [result.request] : [];
  });
  const navigation = normalizeNavigation({
    id: 'nav',
    timestamp: 0,
    url: `${SHOP}/reset?token=${CANARIES.navigationToken}`,
    context: { tabId: 1, frameId: 0, documentId: 'doc-cart' },
  });
  return {
    schemaVersion: 1,
    id: 's1',
    name: 'Hostile',
    source: 'playwright',
    startedAt: 0,
    endedAt: 1_000,
    requests,
    navigations: navigation.ok ? [navigation.navigation] : [],
    droppedRequestCount: 0,
    triage: {},
  };
}

describe('sensitive-data redaction', () => {
  const captured = session();
  const analysis = analyzeRequests(captured);
  const baseline = createBaseline(analysis, { name: 'b', createdAt: 0 });
  const outputs = {
    session: JSON.stringify(captured),
    analysis: JSON.stringify(analysis),
    baseline: JSON.stringify(baseline),
    regression: JSON.stringify(compareWithBaseline(analysis, { ...baseline, endpoints: [] })),
  };

  it('normalises every hostile observation (none is silently dropped)', () => {
    expect(captured.requests).toHaveLength(hostileObservations().length);
  });

  it.each(Object.entries(CANARIES))('never persists the %s canary', (_channel, canary) => {
    for (const [name, text] of Object.entries(outputs)) {
      expect(text.includes(canary), `${name} contains ${canary}`).toBe(false);
      expect(text.includes(encodeURIComponent(canary)), `${name} contains encoded ${canary}`).toBe(
        false,
      );
    }
  });

  it('keeps the evidence testers need', () => {
    expect(outputs.session).toContain('q=shoes');
    expect(outputs.session).toContain('X-Amz-Expires=60');
    expect(outputs.session).toContain('/api/reset/:token/for/:email');
    expect(outputs.session).toContain('[REDACTED]');
  });
});

describe('hostile rule files', () => {
  // A backtracking implementation would not finish within the test timeout.
  it('evaluates pathological patterns without catastrophic backtracking', () => {
    const rules = parseRuleSet({
      schemaVersion: 1,
      name: 'Hostile',
      endpoints: [
        { id: 'stars', match: { path: `/${'*a'.repeat(400)}b` }, forbidden: true },
        { id: 'globs', match: { path: `/${'**/'.repeat(300)}x` }, forbidden: true },
      ],
    });
    expect(rules.ok).toBe(true);
    if (!rules.ok) {
      return;
    }
    const raw = observation('long', 0, { url: `${SHOP}/${'a'.repeat(8_000)}` });
    const normalized = normalizeRequest(raw);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const result = analyzeRequests(
        { requests: [normalized.request], navigations: [] },
        rules.value,
      );
      expect(result.findings).toEqual([]);
    }
  });

  it('rejects a rule file that tries to smuggle in a prototype', () => {
    const result = parseRuleSet(
      '{"schemaVersion":1,"name":"x","__proto__":{"strictEndpoints":true}}',
    );
    expect(result.ok).toBe(false);
    expect(Object.prototype).not.toHaveProperty('strictEndpoints');
  });
});

describe('sensitive-data redaction in exported reports', () => {
  const captured = session();
  const analysis = analyzeRequests(captured);
  const built = buildReport({
    session: captured,
    analysis,
    regression: compareWithBaseline(analysis, {
      ...createBaseline(analysis, { name: 'b', createdAt: 0 }),
      endpoints: [],
    }),
    generatedAt: 0,
    toolVersion: '0.1.0',
  });

  it('builds a valid report', () => {
    expect(built.ok).toBe(true);
  });

  const report = built.ok ? built.value : null;
  const exports =
    report === null
      ? {}
      : {
          json: reportToJson(report),
          html: reportToHtml(report),
          findingsCsv: findingsToCsv(report),
          endpointsCsv: endpointsToCsv(report),
        };

  it.each(Object.entries(CANARIES))('never exports the %s canary', (_channel, canary) => {
    for (const [format, text] of Object.entries(exports)) {
      expect(text.includes(canary), `${format} contains ${canary}`).toBe(false);
      expect(
        text.includes(encodeURIComponent(canary)),
        `${format} contains encoded ${canary}`,
      ).toBe(false);
    }
  });
});
