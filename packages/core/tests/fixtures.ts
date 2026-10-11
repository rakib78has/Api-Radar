import {
  detectionRuleSetSchema,
  type CapturedRequest,
  type DetectionRuleSet,
  type DetectionRuleSetInput,
  type NavigationEvent,
  type RawRequestObservation,
  type RequestContext,
} from '@api-qa/contracts';

import { normalizeRequest, type NormalizationOptions } from '../src/index.js';

export const ORIGIN = 'https://app.test';

/** A raw XHR GET from tab 1, document `doc-1`, that succeeded in 10 ms. */
export function rawRequest(
  overrides: Partial<Omit<RawRequestObservation, 'context'>> & {
    readonly context?: Partial<RequestContext>;
  } = {},
): RawRequestObservation {
  const { context, ...rest } = overrides;
  return {
    id: 'r1',
    timestamp: 1_000,
    source: 'playwright',
    method: 'GET',
    url: `${ORIGIN}/api/items`,
    resourceType: 'xhr',
    status: 200,
    error: null,
    durationMs: 10,
    initiator: ORIGIN,
    body: { kind: 'absent' },
    ...rest,
    context: { tabId: 1, frameId: 0, documentId: 'doc-1', ...context },
  };
}

/** A normalised request; fails the test if normalisation rejects it. */
export function request(
  overrides: Parameters<typeof rawRequest>[0] = {},
  options?: NormalizationOptions,
): CapturedRequest {
  const result = normalizeRequest(rawRequest(overrides), options);
  if (!result.ok) {
    throw new Error(`Fixture request rejected: ${result.reason}`);
  }
  return result.request;
}

/** Requests with ids `${prefix}1..n` at the given timestamps; other fields from `overrides`. */
export function requestsAt(
  timestamps: readonly number[],
  overrides: Parameters<typeof rawRequest>[0] = {},
  prefix = 'r',
): CapturedRequest[] {
  return timestamps.map((timestamp, index) =>
    request({ ...overrides, id: `${prefix}${String(index + 1)}`, timestamp }),
  );
}

export function ruleSet(input: Partial<DetectionRuleSetInput> = {}): DetectionRuleSet {
  return detectionRuleSetSchema.parse({ schemaVersion: 1, name: 'Test rules', ...input });
}

export function navigation(
  id: string,
  timestamp: number,
  documentId: string | null,
  context: Partial<RequestContext> = {},
): NavigationEvent {
  return {
    id,
    timestamp,
    url: `${ORIGIN}/page-${id}`,
    context: { tabId: 1, frameId: 0, documentId, ...context },
  };
}
