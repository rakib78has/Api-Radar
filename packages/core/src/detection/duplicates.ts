import type { CapturedRequest, Confidence, DetectionRuleSet, Finding } from '@api-qa/contracts';

import { duplicateSeverity, minConfidence } from '../confidence/classification.js';
import { buildFinding, evidenceFrom, formatMs } from './findings.js';
import { carriesBody, contextKey, groupBy, intervals } from './requests.js';

/** Splits time-ordered requests wherever the gap to the previous one exceeds `windowMs`. */
function burstsWithin(requests: readonly CapturedRequest[], windowMs: number): CapturedRequest[][] {
  const bursts: CapturedRequest[][] = [];
  let burst: CapturedRequest[] = [];
  for (const request of requests) {
    const previous = burst.at(-1);
    if (previous !== undefined && request.timestamp - previous.timestamp > windowMs) {
      bursts.push(burst);
      burst = [];
    }
    burst.push(request);
  }
  bursts.push(burst);
  return bursts.filter((candidate) => candidate.length > 1);
}

/**
 * How sure we are that the copies are the same operation. Equal fingerprints
 * are strong evidence, weakened when the page context or the body is unknown.
 */
function duplicateConfidence(burst: readonly CapturedRequest[]): {
  confidence: Confidence;
  caveats: string[];
} {
  let confidence: Confidence = 'high';
  const caveats: string[] = [];
  if (burst.some((request) => request.context.documentId === null)) {
    confidence = minConfidence(confidence, 'medium');
    caveats.push('The capture source did not report which document sent them.');
  }
  const first = burst[0];
  const bodyUnknown = burst.some(
    (request) =>
      request.fingerprint.bodyStatus === 'truncated' ||
      request.fingerprint.bodyStatus === 'unavailable',
  );
  if (first !== undefined && carriesBody(first.method) && bodyUnknown) {
    confidence = 'low';
    caveats.push('Their bodies could not be compared, so they may carry different data.');
  }
  return { confidence, caveats };
}

/**
 * Rule A. Equivalent requests (same method, origin, path, canonical query and
 * body) from the same tab and document, each within `windowMs` of the
 * previous one. Retry attempts and configured polling are excluded by the
 * caller, so repetition explained by policy is not reported here.
 */
export function detectDuplicates(
  requests: readonly CapturedRequest[],
  config: DetectionRuleSet['duplicates'],
): Finding[] {
  if (!config.enabled) {
    return [];
  }
  const groups = groupBy(
    requests,
    (request) => `${contextKey(request)}|${request.fingerprint.requestKey}`,
  );
  const findings: Finding[] = [];
  for (const [groupKey, group] of groups) {
    for (const burst of burstsWithin(group, config.windowMs)) {
      const first = burst[0];
      const last = burst.at(-1);
      if (first === undefined || last === undefined) {
        continue;
      }
      const { confidence, caveats } = duplicateConfidence(burst);
      const gaps = intervals(burst);
      findings.push(
        buildFinding({
          type: 'duplicate-request',
          ruleId: 'duplicate-request',
          identity: `${groupKey}|${first.id}`,
          severity: duplicateSeverity(first.method, burst.length),
          confidence,
          title: `${first.method} request sent ${String(burst.length)} times`,
          reasoning: [
            `${String(burst.length)} equivalent requests from the same page within ${formatMs(last.timestamp - first.timestamp)}`,
            `(each within ${formatMs(config.windowMs)} of the previous); none was a retry of a failure.`,
            ...caveats,
          ].join(' '),
          endpoint: first.fingerprint.endpoint,
          evidence: evidenceFrom(burst, {
            method: first.method,
            copies: burst.length,
            spanMs: last.timestamp - first.timestamp,
            shortestGapMs: Math.min(...gaps),
            windowMs: config.windowMs,
            url: first.url,
          }),
        }),
      );
    }
  }
  return findings;
}
