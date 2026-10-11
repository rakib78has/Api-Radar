import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseBaseline,
  parseCaptureSession,
  parseRuleSet,
  parseSanitizedReport,
  type CaptureSession,
  type DetectionRuleSet,
  type RawRequestObservation,
  type SanitizedReport,
} from '@api-qa/contracts';
import {
  analyzeRequests,
  compareWithBaseline,
  createBaseline,
  normalizeNavigation,
  normalizeRequest,
} from '@api-qa/core';
import { describe, expect, it } from 'vitest';

import { SHOP, observation } from '../support/capture.js';

const examplesDir = fileURLToPath(new URL('../../examples/test-rules', import.meta.url));

function loadRuleSet(file: string): DetectionRuleSet {
  const result = parseRuleSet(readFileSync(join(examplesDir, file), 'utf8'));
  if (!result.ok) {
    throw new Error(`${file}: ${result.issues.join('; ')}`);
  }
  return result.value;
}

/** Normalises raw observations into a session the way a capture adapter will. */
function capture(
  id: string,
  observations: readonly RawRequestObservation[],
  rules: DetectionRuleSet,
): CaptureSession {
  const requests = [];
  let dropped = 0;
  for (const raw of observations) {
    const result = normalizeRequest(raw, rules.normalization);
    if (result.ok) {
      requests.push(result.request);
    } else {
      dropped++;
    }
  }
  const navigation = normalizeNavigation(
    {
      id: 'nav-1',
      timestamp: 0,
      url: `${SHOP}/cart`,
      context: { tabId: 1, frameId: 0, documentId: 'doc-cart' },
    },
    rules.normalization,
  );
  return {
    schemaVersion: 1,
    id,
    name: `Checkout ${id}`,
    source: 'playwright',
    startedAt: 0,
    endedAt: 60_000,
    requests,
    navigations: navigation.ok ? [navigation.navigation] : [],
    droppedRequestCount: dropped,
    triage: {},
  };
}

/** A clean checkout: cart, one order, status polling every 5 s, telemetry. */
function cleanRun(): RawRequestObservation[] {
  return [
    observation('cart', 100),
    observation('order', 2_000, {
      method: 'POST',
      url: `${SHOP}/api/orders`,
      status: 201,
      body: { kind: 'text', text: '{"sku":"A1","qty":1}', contentType: 'application/json' },
    }),
    ...[3_000, 8_000, 13_000].map((timestamp, i) =>
      observation(`status${String(i)}`, timestamp, {
        url: `${SHOP}/api/orders/77/status?_=${String(timestamp)}`,
      }),
    ),
    observation('telemetry', 3_100, {
      method: 'POST',
      url: 'https://telemetry.example.com/collect',
    }),
    observation('ftp', 3_200, { url: 'ftp://files.test/x' }),
  ];
}

describe('example rule files', () => {
  it.each(readdirSync(examplesDir).filter((file) => file.endsWith('.json')))(
    '%s is a valid rule set',
    (file) => {
      expect(loadRuleSet(file).schemaVersion).toBe(1);
    },
  );
});

describe('capture -> analysis -> baseline -> regression pipeline', () => {
  const rules = loadRuleSet('checkout-flow.json');

  it('finds nothing in a clean run and records what it dropped', () => {
    const session = capture('clean', cleanRun(), rules);
    expect(parseCaptureSession(session).ok).toBe(true);
    expect(session.droppedRequestCount).toBe(1);

    const analysis = analyzeRequests(session, rules);
    expect(analysis.findings).toEqual([]);
    expect(analysis.skippedRequestCount).toBe(1);
  });

  it('flags a regressed run against a baseline that survived a JSON round trip', () => {
    const baselineAnalysis = analyzeRequests(capture('clean', cleanRun(), rules), rules);
    const stored = JSON.stringify(
      createBaseline(baselineAnalysis, { name: 'Checkout', createdAt: 1 }),
    );
    const baseline = parseBaseline(stored);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) {
      return;
    }

    const regressed = capture(
      'regressed',
      [
        ...cleanRun(),
        observation('order-again', 2_050, {
          method: 'POST',
          url: `${SHOP}/api/orders`,
          status: 201,
          body: { kind: 'text', text: '{"qty":1,"sku":"A1"}', contentType: 'application/json' },
        }),
        observation('legacy', 4_000, { url: `${SHOP}/api/v1/recommendations` }),
      ],
      rules,
    );
    const analysis = analyzeRequests(regressed, rules);
    expect(analysis.findings.map((finding) => finding.type).sort()).toEqual([
      'duplicate-request',
      'forbidden-endpoint',
      'unexpected-call-count',
    ]);

    const regression = compareWithBaseline(analysis, baseline.value, rules, regressed.id);
    expect(regression.passed).toBe(false);
    // Two orders against a baseline of one is within `countToleranceAbsolute: 1`,
    // so only the new endpoint and the three new findings are regressions.
    expect(regression.findings.map((finding) => finding.type).sort()).toEqual([
      'regression-new-endpoint',
      'regression-new-finding',
      'regression-new-finding',
      'regression-new-finding',
    ]);

    const report: SanitizedReport = {
      schemaVersion: 1,
      generatedAt: 70_000,
      tool: { name: 'api-qa-inspector', version: '0.1.0' },
      session: {
        id: regressed.id,
        name: regressed.name,
        source: regressed.source,
        startedAt: regressed.startedAt,
        endedAt: regressed.endedAt,
        requestCount: regressed.requests.length,
        droppedRequestCount: regressed.droppedRequestCount,
      },
      ruleSetName: analysis.ruleSetName,
      findings: analysis.findings.map((finding) => ({ ...finding, triage: 'open' })),
      endpoints: [...analysis.endpointStats],
      regression,
    };
    expect(parseSanitizedReport(JSON.parse(JSON.stringify(report))).ok).toBe(true);
  });
});
