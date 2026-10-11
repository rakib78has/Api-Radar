import { z } from 'zod';

import {
  LIMITS,
  confidenceSchema,
  countSchema,
  identifierSchema,
  severitySchema,
  textSchema,
  timestampSchema,
} from './common.js';

export const FINDING_TYPES = [
  'duplicate-request',
  'retry-loop',
  'excessive-polling',
  'request-after-navigation',
  'missing-required-endpoint',
  'forbidden-endpoint',
  'unexpected-call-count',
  'unexpected-endpoint',
  'regression-new-endpoint',
  'regression-missing-endpoint',
  'regression-request-count',
  'regression-failure-rate',
  'regression-duration',
  'regression-new-finding',
] as const;
export const findingTypeSchema = z.enum(FINDING_TYPES);
export type FindingType = z.infer<typeof findingTypeSchema>;

/** A tester's decision about a finding. */
export const TRIAGE_STATUSES = ['open', 'confirmed', 'expected', 'ignored'] as const;
export const triageStatusSchema = z.enum(TRIAGE_STATUSES);
export type TriageStatus = z.infer<typeof triageStatusSchema>;

export const measurementValueSchema = z.union([
  z.string().max(LIMITS.textLength),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type MeasurementValue = z.infer<typeof measurementValueSchema>;

export const findingEvidenceSchema = z.strictObject({
  /** Ids of the requests involved, at most LIMITS.evidenceRequestIds. */
  requestIds: z.array(identifierSchema).max(LIMITS.evidenceRequestIds),
  /** How many requests are involved in total; may exceed `requestIds.length`. */
  requestCount: countSchema,
  firstTimestamp: timestampSchema.nullable(),
  lastTimestamp: timestampSchema.nullable(),
  /** Named numbers and facts behind the finding, e.g. `medianIntervalMs`. */
  measurements: z
    .record(z.string().min(1).max(64), measurementValueSchema)
    .refine((value) => Object.keys(value).length <= LIMITS.evidenceMeasurements, {
      message: `At most ${String(LIMITS.evidenceMeasurements)} measurements`,
    }),
});
export type FindingEvidence = z.infer<typeof findingEvidenceSchema>;

export const findingSchema = z.strictObject({
  /** Stable for the same session and rule set, so triage decisions survive re-analysis. */
  id: identifierSchema,
  type: findingTypeSchema,
  /** The built-in detector id, or the id of the endpoint rule / polling policy that fired. */
  ruleId: identifierSchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  title: z.string().min(1).max(LIMITS.nameLength),
  /** Why the detector reported this, in plain language. */
  reasoning: textSchema,
  endpoint: z.string().max(LIMITS.urlLength).nullable(),
  evidence: findingEvidenceSchema,
});
export type Finding = z.infer<typeof findingSchema>;
