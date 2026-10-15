import {
  parseCaptureSession,
  type CaptureSession,
  type CapturedRequest,
  type DetectionRuleSet,
  type NavigationEvent,
} from '@api-qa/contracts';
import { normalizeNavigation, normalizeRequest } from '@api-qa/core';

import type { CapturedEvents } from './cdp-assembler.js';

export interface SessionMetadata {
  readonly id: string;
  readonly name: string;
  readonly startedAt: number;
  readonly endedAt: number;
}

/**
 * Normalises and redacts raw events exactly as the extension does, and
 * validates the result. Rejected observations are counted, not lost silently.
 */
export function buildSession(
  events: CapturedEvents,
  ruleSet: DetectionRuleSet,
  metadata: SessionMetadata,
): CaptureSession {
  const requests: CapturedRequest[] = [];
  let dropped = 0;
  for (const raw of events.requests) {
    const result = normalizeRequest(raw, ruleSet.normalization);
    if (result.ok) {
      requests.push(result.request);
    } else {
      dropped++;
    }
  }
  const navigations: NavigationEvent[] = events.navigations.flatMap((raw) => {
    const result = normalizeNavigation(raw, ruleSet.normalization);
    return result.ok ? [result.navigation] : [];
  });
  const parsed = parseCaptureSession({
    schemaVersion: 1,
    id: metadata.id,
    name: metadata.name,
    source: 'playwright',
    startedAt: metadata.startedAt,
    endedAt: Math.max(metadata.endedAt, metadata.startedAt),
    requests,
    navigations,
    droppedRequestCount: dropped,
    triage: {},
  });
  if (!parsed.ok) {
    throw new Error(`Captured session is invalid: ${parsed.issues.join('; ')}`);
  }
  return parsed.value;
}
