import type { CapturedRequest, Confidence, Finding } from '@api-qa/contracts';

import {
  describeMatcher,
  type CompiledEndpointRule,
  type CompiledPollingPolicy,
} from '../rules/compiled.js';
import { buildFinding, evidenceFrom } from './findings.js';
import { groupBy, sharedEndpoint } from './requests.js';

export interface EndpointRuleInput {
  readonly requests: readonly CapturedRequest[];
  /** Non-excluded endpoint rules. */
  readonly rules: readonly CompiledEndpointRule[];
  readonly policies: readonly CompiledPollingPolicy[];
  /** Retry attempts count as part of the operation they retry, not as extra calls. */
  readonly retryAttemptIds: ReadonlySet<string>;
  readonly strictEndpoints: boolean;
  /** Requests the capture dropped; missing calls are then less certain. */
  readonly droppedRequestCount: number;
}

function countFinding(
  compiled: CompiledEndpointRule,
  calls: readonly CapturedRequest[],
  expectation: string,
  tooFew: boolean,
  confidence: Confidence,
): Finding {
  const { rule } = compiled;
  return buildFinding({
    type: 'unexpected-call-count',
    ruleId: rule.id,
    identity: `count|${expectation}`,
    severity: tooFew && calls.length === 0 ? 'high' : 'medium',
    confidence: tooFew ? confidence : 'high',
    title: `${describeMatcher(rule.match)} called ${String(calls.length)} times, expected ${expectation}`,
    reasoning:
      `Rule "${rule.id}" expects ${expectation} call(s); ${String(calls.length)} were made. ` +
      'Retries of a failed call count as one call.',
    endpoint: sharedEndpoint(calls),
    evidence: evidenceFrom(calls, {
      pattern: describeMatcher(rule.match),
      calls: calls.length,
      expected: expectation,
    }),
  });
}

/**
 * Rule D. Checks each workflow rule: required, forbidden, exact, minimum and
 * maximum call counts. With `strictEndpoints`, API calls that no rule or
 * polling policy covers are reported as unexpected.
 */
export function evaluateEndpointRules(input: EndpointRuleInput): Finding[] {
  const operations = input.requests.filter((request) => !input.retryAttemptIds.has(request.id));
  const absenceConfidence: Confidence = input.droppedRequestCount > 0 ? 'medium' : 'high';
  const droppedNote =
    input.droppedRequestCount > 0
      ? ` The capture dropped ${String(input.droppedRequestCount)} request(s), so a call may have been missed.`
      : '';
  const findings: Finding[] = [];

  for (const compiled of input.rules) {
    const { rule } = compiled;
    const calls = operations.filter(compiled.matches);
    const pattern = describeMatcher(rule.match);

    if (rule.forbidden && calls.length > 0) {
      findings.push(
        buildFinding({
          type: 'forbidden-endpoint',
          ruleId: rule.id,
          identity: 'forbidden',
          severity: 'high',
          confidence: 'high',
          title: `Forbidden endpoint ${pattern} was called`,
          reasoning: `Rule "${rule.id}" forbids calls to ${pattern}; ${String(calls.length)} were made.`,
          endpoint: sharedEndpoint(calls),
          evidence: evidenceFrom(calls, { pattern, calls: calls.length }),
        }),
      );
    }

    if (rule.required && calls.length === 0) {
      findings.push(
        buildFinding({
          type: 'missing-required-endpoint',
          ruleId: rule.id,
          identity: 'required',
          severity: 'high',
          confidence: absenceConfidence,
          title: `Required endpoint ${pattern} was never called`,
          reasoning: `Rule "${rule.id}" requires at least one call to ${pattern}; none was captured.${droppedNote}`,
          endpoint: null,
          evidence: evidenceFrom([], { pattern, calls: 0 }),
        }),
      );
      continue;
    }

    const count = calls.length;
    if (rule.expectedCount !== null && count !== rule.expectedCount) {
      const tooFew = count < rule.expectedCount;
      findings.push(
        countFinding(
          compiled,
          calls,
          `exactly ${String(rule.expectedCount)}`,
          tooFew,
          absenceConfidence,
        ),
      );
    }
    if (rule.minCount !== null && count < rule.minCount) {
      findings.push(
        countFinding(compiled, calls, `at least ${String(rule.minCount)}`, true, absenceConfidence),
      );
    }
    if (rule.maxCount !== null && count > rule.maxCount) {
      findings.push(
        countFinding(compiled, calls, `at most ${String(rule.maxCount)}`, false, absenceConfidence),
      );
    }
  }

  if (input.strictEndpoints) {
    const unexpected = operations.filter(
      (request) =>
        !input.rules.some((compiled) => compiled.matches(request)) &&
        !input.policies.some((compiled) => compiled.matches(request)),
    );
    for (const [endpoint, calls] of groupBy(
      unexpected,
      (request) => request.fingerprint.endpoint,
    )) {
      findings.push(
        buildFinding({
          type: 'unexpected-endpoint',
          ruleId: 'strict-endpoints',
          identity: endpoint,
          severity: 'low',
          confidence: 'medium',
          title: `Unexpected endpoint called ${String(calls.length)} times`,
          reasoning:
            'Strict endpoint mode is on and no endpoint rule or polling policy covers this endpoint. ' +
            'Add a rule if the call is intended.',
          endpoint,
          evidence: evidenceFrom(calls, { calls: calls.length }),
        }),
      );
    }
  }
  return findings;
}
