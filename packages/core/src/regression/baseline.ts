import {
  DEFAULT_RULE_SET,
  type Baseline,
  type DetectionRuleSet,
  type EndpointStats,
  type Finding,
  type FindingKey,
  type RegressionResult,
} from '@api-qa/contracts';

import type { AnalysisResult } from '../analysis/analyze.js';
import { buildFinding, compareFindings, formatMs } from '../detection/findings.js';

const REGRESSION_RULE_ID = 'regression';

function isRegressionFinding(finding: Finding): boolean {
  return finding.type.startsWith('regression-');
}

function findingKeyString(key: FindingKey): string {
  return `${key.type}|${key.endpoint ?? ''}`;
}

/** Unique (type, endpoint) pairs of the non-regression findings, sorted. */
export function findingKeysOf(findings: readonly Finding[]): FindingKey[] {
  const keys = new Map<string, FindingKey>();
  for (const finding of findings.filter((candidate) => !isRegressionFinding(candidate))) {
    const key = { type: finding.type, endpoint: finding.endpoint };
    keys.set(findingKeyString(key), key);
  }
  return [...keys].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, key]) => key);
}

export interface BaselineMetadata {
  readonly name: string;
  readonly createdAt: number;
}

/** Records an analysis as the reference that later runs are compared with. */
export function createBaseline(analysis: AnalysisResult, metadata: BaselineMetadata): Baseline {
  return {
    schemaVersion: 1,
    name: metadata.name,
    createdAt: metadata.createdAt,
    ruleSetName: analysis.ruleSetName,
    endpoints: analysis.endpointStats.map((stats) => ({ ...stats })),
    findingKeys: findingKeysOf(analysis.findings),
  };
}

function statsEvidence(stats: EndpointStats, measurements: Finding['evidence']['measurements']) {
  return {
    requestIds: [],
    requestCount: stats.requestCount,
    firstTimestamp: null,
    lastTimestamp: null,
    measurements,
  };
}

function failureRate(stats: EndpointStats): number {
  return stats.requestCount === 0 ? 0 : stats.failureCount / stats.requestCount;
}

/** Below this many timed requests a p95 is too noisy to be more than a hint. */
const RELIABLE_TIMING_SAMPLE = 5;

function compareEndpoint(
  current: EndpointStats,
  baseline: EndpointStats,
  tolerance: DetectionRuleSet['regression'],
): Finding[] {
  const findings: Finding[] = [];
  const { endpoint } = current;

  const allowedCount =
    baseline.requestCount +
    Math.max(
      tolerance.countToleranceAbsolute,
      Math.ceil(baseline.requestCount * tolerance.countToleranceRatio),
    );
  if (current.requestCount > allowedCount) {
    const doubled = baseline.requestCount > 0 && current.requestCount >= baseline.requestCount * 2;
    findings.push(
      buildFinding({
        type: 'regression-request-count',
        ruleId: REGRESSION_RULE_ID,
        identity: endpoint,
        severity: doubled ? 'high' : 'medium',
        confidence: 'high',
        title: `Request count rose from ${String(baseline.requestCount)} to ${String(current.requestCount)}`,
        reasoning: `The baseline made ${String(baseline.requestCount)} request(s) to this endpoint; this run made ${String(current.requestCount)}, above the allowed ${String(allowedCount)}.`,
        endpoint,
        evidence: statsEvidence(current, {
          baselineCount: baseline.requestCount,
          currentCount: current.requestCount,
          allowedCount,
        }),
      }),
    );
  }

  const baselineRate = failureRate(baseline);
  const currentRate = failureRate(current);
  if (currentRate - baselineRate > tolerance.failureRateTolerance) {
    findings.push(
      buildFinding({
        type: 'regression-failure-rate',
        ruleId: REGRESSION_RULE_ID,
        identity: endpoint,
        severity: 'high',
        confidence: current.requestCount >= RELIABLE_TIMING_SAMPLE ? 'high' : 'medium',
        title: `Failure rate rose from ${String(Math.round(baselineRate * 100))}% to ${String(Math.round(currentRate * 100))}%`,
        reasoning: `${String(current.failureCount)} of ${String(current.requestCount)} request(s) failed, against ${String(baseline.failureCount)} of ${String(baseline.requestCount)} in the baseline.`,
        endpoint,
        evidence: statsEvidence(current, {
          baselineFailureRate: baselineRate,
          currentFailureRate: currentRate,
          tolerance: tolerance.failureRateTolerance,
        }),
      }),
    );
  }

  const baselineP95 = baseline.durationP95Ms;
  const currentP95 = current.durationP95Ms;
  if (
    baselineP95 !== null &&
    currentP95 !== null &&
    baselineP95 > 0 &&
    currentP95 > baselineP95 * (1 + tolerance.durationToleranceRatio) &&
    currentP95 - baselineP95 > tolerance.durationToleranceMs
  ) {
    findings.push(
      buildFinding({
        type: 'regression-duration',
        ruleId: REGRESSION_RULE_ID,
        identity: endpoint,
        severity: 'medium',
        confidence:
          current.timedRequestCount >= RELIABLE_TIMING_SAMPLE &&
          baseline.timedRequestCount >= RELIABLE_TIMING_SAMPLE
            ? 'medium'
            : 'low',
        title: `p95 duration rose from ${formatMs(baselineP95)} to ${formatMs(currentP95)}`,
        reasoning:
          'Measured durations depend on the machine and network, so treat timing regressions as a ' +
          'prompt to investigate rather than proof.',
        endpoint,
        evidence: statsEvidence(current, {
          baselineP95Ms: baselineP95,
          currentP95Ms: currentP95,
          toleranceRatio: tolerance.durationToleranceRatio,
          toleranceMs: tolerance.durationToleranceMs,
        }),
      }),
    );
  }
  return findings;
}

/**
 * Rule E. Compares an analysis with a validated baseline: new and missing
 * endpoints, request counts, failure rates, p95 durations, and findings that
 * did not exist when the baseline was recorded.
 */
export function compareWithBaseline(
  analysis: AnalysisResult,
  baseline: Baseline,
  ruleSet: DetectionRuleSet = DEFAULT_RULE_SET,
  sessionId: string | null = null,
): RegressionResult {
  const tolerance = ruleSet.regression;
  const baselineByEndpoint = new Map(baseline.endpoints.map((stats) => [stats.endpoint, stats]));
  const currentEndpoints = new Set(analysis.endpointStats.map((stats) => stats.endpoint));
  const findings: Finding[] = [];

  for (const current of analysis.endpointStats) {
    const reference = baselineByEndpoint.get(current.endpoint);
    if (reference === undefined) {
      findings.push(
        buildFinding({
          type: 'regression-new-endpoint',
          ruleId: REGRESSION_RULE_ID,
          identity: current.endpoint,
          severity: 'medium',
          confidence: 'high',
          title: `New endpoint called ${String(current.requestCount)} times`,
          reasoning: 'This endpoint was not called when the baseline was recorded.',
          endpoint: current.endpoint,
          evidence: statsEvidence(current, { currentCount: current.requestCount }),
        }),
      );
    } else {
      findings.push(...compareEndpoint(current, reference, tolerance));
    }
  }

  if (tolerance.reportMissingEndpoints) {
    for (const reference of baseline.endpoints) {
      if (!currentEndpoints.has(reference.endpoint)) {
        findings.push(
          buildFinding({
            type: 'regression-missing-endpoint',
            ruleId: REGRESSION_RULE_ID,
            identity: reference.endpoint,
            severity: 'medium',
            confidence: 'medium',
            title: 'Endpoint from the baseline was not called',
            reasoning: `The baseline called this endpoint ${String(reference.requestCount)} time(s); this run never did. The workflow may have changed or a feature may be broken.`,
            endpoint: reference.endpoint,
            evidence: statsEvidence(
              { ...reference, requestCount: 0 },
              {
                baselineCount: reference.requestCount,
              },
            ),
          }),
        );
      }
    }
  }

  const knownKeys = new Set(baseline.findingKeys.map(findingKeyString));
  for (const finding of analysis.findings.filter((candidate) => !isRegressionFinding(candidate))) {
    if (!knownKeys.has(findingKeyString({ type: finding.type, endpoint: finding.endpoint }))) {
      findings.push(
        buildFinding({
          type: 'regression-new-finding',
          ruleId: REGRESSION_RULE_ID,
          identity: finding.id,
          severity: finding.severity,
          confidence: finding.confidence,
          title: `New ${finding.type}: ${finding.title}`,
          reasoning: `The baseline had no ${finding.type} finding for this endpoint. ${finding.reasoning}`,
          endpoint: finding.endpoint,
          evidence: finding.evidence,
        }),
      );
    }
  }

  const sorted = findings.sort(compareFindings);
  return {
    baselineName: baseline.name,
    passed: sorted.length === 0,
    comparedEndpointCount: new Set([...currentEndpoints, ...baselineByEndpoint.keys()]).size,
    findings: sorted,
    sessionId,
  };
}
