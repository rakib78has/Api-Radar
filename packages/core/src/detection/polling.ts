import type { CapturedRequest, Confidence, Finding } from '@api-qa/contracts';

import type { CompiledPollingPolicy } from '../rules/compiled.js';
import { buildFinding, evidenceFrom, formatMs } from './findings.js';
import { contextKey, groupBy, intervals } from './requests.js';

export interface PollingAnalysis {
  readonly findings: readonly Finding[];
  /** Requests covered by a polling policy; the duplicate detector skips them. */
  readonly polledRequestIds: ReadonlySet<string>;
}

/** Lower median: deterministic and always one of the observed values. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function pollingConfidence(intervalCount: number): Confidence {
  if (intervalCount >= 4) {
    return 'high';
  }
  return intervalCount >= 2 ? 'medium' : 'low';
}

/**
 * Rule B. Only endpoints with a configured policy are checked. A page polls
 * too often when its median interval is below `expectedIntervalMs × (1 −
 * tolerance)`. The median ignores one-off timer jitter.
 */
export function detectExcessivePolling(
  requests: readonly CapturedRequest[],
  policies: readonly CompiledPollingPolicy[],
): PollingAnalysis {
  const polledRequestIds = new Set<string>();
  // The first matching policy owns a request.
  const owned = groupBy(
    requests.filter((request) => policies.some((policy) => policy.matches(request))),
    (request) => policies.find((policy) => policy.matches(request))?.policy.id ?? '',
  );
  for (const group of owned.values()) {
    for (const request of group) {
      polledRequestIds.add(request.id);
    }
  }

  const findings: Finding[] = [];
  for (const { policy } of policies) {
    const matched = owned.get(policy.id) ?? [];
    const groups = groupBy(
      matched,
      (request) => `${contextKey(request)}|${request.fingerprint.endpoint}`,
    );
    for (const [groupKey, group] of groups) {
      const first = group[0];
      if (group.length < 2 || first === undefined) {
        continue;
      }
      const gaps = intervals(group);
      const medianInterval = median(gaps);
      const minimumAllowed = policy.expectedIntervalMs * (1 - policy.tolerance);
      if (medianInterval >= minimumAllowed) {
        continue;
      }
      findings.push(
        buildFinding({
          type: 'excessive-polling',
          ruleId: policy.id,
          identity: `${groupKey}|${first.id}`,
          severity: medianInterval * 4 <= policy.expectedIntervalMs ? 'high' : 'medium',
          confidence: pollingConfidence(gaps.length),
          title: `Polling every ${formatMs(medianInterval)}, expected every ${formatMs(policy.expectedIntervalMs)}`,
          reasoning:
            `Median interval over ${String(gaps.length)} gaps is ${formatMs(medianInterval)}, below the ` +
            `${formatMs(minimumAllowed)} the policy allows (${formatMs(policy.expectedIntervalMs)} with ` +
            `${String(Math.round(policy.tolerance * 100))}% tolerance).` +
            (gaps.length < 2 ? ' Only one interval was observed.' : ''),
          endpoint: first.fingerprint.endpoint,
          evidence: evidenceFrom(group, {
            expectedIntervalMs: policy.expectedIntervalMs,
            tolerance: policy.tolerance,
            medianIntervalMs: medianInterval,
            shortestIntervalMs: Math.min(...gaps),
            intervalCount: gaps.length,
          }),
        }),
      );
    }
  }
  return { findings, polledRequestIds };
}
