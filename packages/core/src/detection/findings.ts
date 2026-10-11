import {
  LIMITS,
  type CapturedRequest,
  type Confidence,
  type Finding,
  type FindingEvidence,
  type FindingType,
  type MeasurementValue,
  type Severity,
} from '@api-qa/contracts';

import { SEVERITY_RANK, findingTypeRank } from '../confidence/classification.js';
import { fnv1a64 } from '../hash.js';

export type Measurements = Readonly<Record<string, MeasurementValue>>;

/** Evidence from the requests behind a finding; ids are capped, the count is not. */
export function evidenceFrom(
  requests: readonly CapturedRequest[],
  measurements: Measurements,
): FindingEvidence {
  return {
    requestIds: requests.slice(0, LIMITS.evidenceRequestIds).map((request) => request.id),
    requestCount: requests.length,
    firstTimestamp: requests[0]?.timestamp ?? null,
    lastTimestamp: requests.at(-1)?.timestamp ?? null,
    measurements: { ...measurements },
  };
}

export interface FindingDraft {
  readonly type: FindingType;
  readonly ruleId: string;
  /** Stable description of what was found; hashed into the finding id. */
  readonly identity: string;
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly title: string;
  readonly reasoning: string;
  readonly endpoint: string | null;
  readonly evidence: FindingEvidence;
}

export function buildFinding(draft: FindingDraft): Finding {
  return {
    id: `${draft.type}:${fnv1a64(`${draft.ruleId}|${draft.identity}`)}`,
    type: draft.type,
    ruleId: draft.ruleId,
    severity: draft.severity,
    confidence: draft.confidence,
    title: draft.title.slice(0, LIMITS.nameLength),
    reasoning: draft.reasoning.slice(0, LIMITS.textLength),
    endpoint: draft.endpoint,
    evidence: draft.evidence,
  };
}

/** Most severe first, then by type, first occurrence and id: a total, input-independent order. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    findingTypeRank(a.type) - findingTypeRank(b.type) ||
    (a.evidence.firstTimestamp ?? Number.MAX_VALUE) -
      (b.evidence.firstTimestamp ?? Number.MAX_VALUE) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function formatMs(ms: number): string {
  return `${String(Math.round(ms))} ms`;
}
