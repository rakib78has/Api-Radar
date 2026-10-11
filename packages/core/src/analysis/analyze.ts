import {
  DEFAULT_RULE_SET,
  type CapturedRequest,
  type DetectionRuleSet,
  type EndpointStats,
  type Finding,
  type NavigationEvent,
} from '@api-qa/contracts';

import { detectDuplicates } from '../detection/duplicates.js';
import { evaluateEndpointRules } from '../detection/endpoint-rules.js';
import { compareFindings } from '../detection/findings.js';
import { detectRequestsAfterNavigation } from '../detection/navigation.js';
import { detectExcessivePolling } from '../detection/polling.js';
import { compareRequests } from '../detection/requests.js';
import { detectRetries } from '../detection/retries.js';
import { compileEndpointRule, compilePollingPolicy } from '../rules/compiled.js';
import { computeEndpointStats } from './stats.js';

/** What analysis needs from a capture. A `CaptureSession` satisfies it. */
export interface AnalysisInput {
  readonly requests: readonly CapturedRequest[];
  readonly navigations: readonly NavigationEvent[];
  readonly droppedRequestCount?: number;
}

export interface AnalysisResult {
  readonly ruleSetName: string;
  /** Sorted most severe first; order is independent of input order. */
  readonly findings: readonly Finding[];
  /** Statistics over analysed requests, sorted by endpoint. */
  readonly endpointStats: readonly EndpointStats[];
  readonly analysedRequestCount: number;
  /** Requests outside the rule set's resource types, or matched by an excluded endpoint rule. */
  readonly skippedRequestCount: number;
}

/**
 * Runs every detector over a capture. Pure and deterministic: the same
 * requests, navigations and rule set always produce the same result.
 */
export function analyzeRequests(
  input: AnalysisInput,
  ruleSet: DetectionRuleSet = DEFAULT_RULE_SET,
): AnalysisResult {
  const endpointRules = ruleSet.endpoints.map(compileEndpointRule);
  const activeRules = endpointRules.filter(({ rule }) => !rule.excluded);
  const excludedRules = endpointRules.filter(({ rule }) => rule.excluded);
  const policies = ruleSet.polling.map(compilePollingPolicy);
  const resourceTypes = new Set(ruleSet.resourceTypes);

  const analysed = [...input.requests]
    .sort(compareRequests)
    .filter(
      (request) =>
        (request.resourceType === null || resourceTypes.has(request.resourceType)) &&
        !excludedRules.some(({ matches }) => matches(request)),
    );

  const retries = detectRetries(analysed, ruleSet.retries, activeRules);
  const polling = detectExcessivePolling(analysed, policies);
  const duplicates = detectDuplicates(
    analysed.filter(
      (request) =>
        !retries.retryAttemptIds.has(request.id) && !polling.polledRequestIds.has(request.id),
    ),
    ruleSet.duplicates,
  );
  const afterNavigation = detectRequestsAfterNavigation(
    analysed,
    input.navigations,
    ruleSet.navigation,
  );
  const endpointFindings = evaluateEndpointRules({
    requests: analysed,
    rules: activeRules,
    policies,
    retryAttemptIds: retries.retryAttemptIds,
    strictEndpoints: ruleSet.strictEndpoints,
    droppedRequestCount: input.droppedRequestCount ?? 0,
  });

  return {
    ruleSetName: ruleSet.name,
    findings: [
      ...duplicates,
      ...retries.findings,
      ...polling.findings,
      ...afterNavigation,
      ...endpointFindings,
    ].sort(compareFindings),
    endpointStats: computeEndpointStats(analysed),
    analysedRequestCount: analysed.length,
    skippedRequestCount: input.requests.length - analysed.length,
  };
}
