import type { CapturedRequest, DetectionRuleSet, Finding } from '@api-qa/contracts';

import type { CompiledEndpointRule } from '../rules/compiled.js';
import { buildFinding, evidenceFrom, formatMs } from './findings.js';
import { contextKey, groupBy, intervals, isFailure, sharedEndpoint } from './requests.js';

export interface RetryAnalysis {
  readonly findings: readonly Finding[];
  /** Every attempt after the first in a retry chain. Other detectors treat these as one operation. */
  readonly retryAttemptIds: ReadonlySet<string>;
}

/**
 * Splits one group of equivalent, time-ordered requests into chains. A request
 * joins the current chain when the previous attempt failed and it started
 * within `windowMs` of that failure.
 */
function retryChains(requests: readonly CapturedRequest[], windowMs: number): CapturedRequest[][] {
  const chains: CapturedRequest[][] = [];
  let chain: CapturedRequest[] = [];
  for (const request of requests) {
    const previous = chain.at(-1);
    if (
      previous !== undefined &&
      isFailure(previous) &&
      request.timestamp - previous.timestamp <= windowMs
    ) {
      chain.push(request);
    } else {
      if (chain.length > 1) {
        chains.push(chain);
      }
      chain = [request];
    }
  }
  if (chain.length > 1) {
    chains.push(chain);
  }
  return chains;
}

function describeOutcome(request: CapturedRequest): string {
  if (request.error !== null) {
    return request.error;
  }
  return request.status === null ? 'unknown status' : `HTTP ${String(request.status)}`;
}

/**
 * Rule C. Repeating a failed request is a retry. A retry chain is reported only
 * when it breaks the policy: more attempts than allowed, or attempts closer
 * together than `minDelayMs`. Chains within policy are legitimate retries.
 */
export function detectRetries(
  requests: readonly CapturedRequest[],
  config: DetectionRuleSet['retries'],
  endpointRules: readonly CompiledEndpointRule[],
): RetryAnalysis {
  const findings: Finding[] = [];
  const retryAttemptIds = new Set<string>();
  const groups = groupBy(
    requests,
    (request) => `${contextKey(request)}|${request.fingerprint.requestKey}`,
  );

  for (const [groupKey, group] of groups) {
    for (const chain of retryChains(group, config.windowMs)) {
      for (const attempt of chain.slice(1)) {
        retryAttemptIds.add(attempt.id);
      }
      const first = chain[0];
      const last = chain.at(-1);
      if (!config.enabled || first === undefined || last === undefined) {
        continue;
      }

      const override = endpointRules.find(
        ({ rule, matches }) => rule.maxRetryAttempts !== null && matches(first),
      );
      const maxAttempts = override?.rule.maxRetryAttempts ?? config.maxAttempts;
      const delays = intervals(chain);
      const shortestDelay = Math.min(...delays);
      const recovered = !isFailure(last);
      const tooMany = chain.length > maxAttempts;
      const tooFast = config.minDelayMs > 0 && shortestDelay < config.minDelayMs;
      if (!tooMany && !tooFast) {
        continue;
      }

      const reasons: string[] = [];
      if (tooMany) {
        reasons.push(
          `${String(chain.length)} attempts exceed the limit of ${String(maxAttempts)}` +
            (recovered ? ' before it succeeded.' : ', and it never succeeded.'),
        );
      }
      if (tooFast) {
        reasons.push(
          `Attempts came ${formatMs(shortestDelay)} apart; the policy requires at least ${formatMs(config.minDelayMs)}.`,
        );
      }

      findings.push(
        buildFinding({
          type: 'retry-loop',
          ruleId: override?.rule.id ?? 'retry-loop',
          identity: `${groupKey}|${first.id}`,
          severity: tooMany && !recovered ? 'high' : 'medium',
          confidence: tooMany && !recovered ? 'high' : 'medium',
          title: `${first.method} request retried ${String(chain.length - 1)} times after failing`,
          reasoning: `Equivalent requests from the same page followed failures (last: ${describeOutcome(last)}). ${reasons.join(' ')}`,
          endpoint: sharedEndpoint(chain),
          evidence: evidenceFrom(chain, {
            attempts: chain.length,
            maxAttempts,
            recovered,
            shortestDelayMs: shortestDelay,
            requiredMinDelayMs: config.minDelayMs,
            lastStatus: last.status,
            lastError: last.error,
          }),
        }),
      );
    }
  }
  return { findings, retryAttemptIds };
}
