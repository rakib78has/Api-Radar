import type { Confidence, FindingType, HttpMethod, Severity } from '@api-qa/contracts';
import { FINDING_TYPES } from '@api-qa/contracts';

import { isNonIdempotent } from '../detection/requests.js';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const CONFIDENCE_ORDER: readonly Confidence[] = ['low', 'medium', 'high'];

/** The lower of two confidence levels. */
export function minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

export function findingTypeRank(type: FindingType): number {
  return FINDING_TYPES.indexOf(type);
}

/** Repeated GETs grow load with every copy. */
const HEAVY_REPETITION = 5;

/**
 * Severity of a duplicate group, driven by impact first:
 * - POST, PATCH, CONNECT: each copy can create or change data again -> high.
 * - PUT, DELETE: idempotent but state-changing; copies risk races -> medium.
 * - Reads: wasted work only -> low, or medium once copies pile up.
 */
export function duplicateSeverity(method: HttpMethod, count: number): Severity {
  if (isNonIdempotent(method)) {
    return 'high';
  }
  if (method === 'PUT' || method === 'DELETE') {
    return 'medium';
  }
  return count >= HEAVY_REPETITION ? 'medium' : 'low';
}
