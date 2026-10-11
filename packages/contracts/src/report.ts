import { z } from 'zod';

import {
  LIMITS,
  captureSourceSchema,
  countSchema,
  identifierSchema,
  nameSchema,
  timestampSchema,
} from './common.js';
import { endpointStatsSchema, regressionResultSchema } from './baseline.js';
import { findingSchema, triageStatusSchema } from './finding.js';

export const reportedFindingSchema = findingSchema.extend({ triage: triageStatusSchema });
export type ReportedFinding = z.infer<typeof reportedFindingSchema>;

/**
 * Exportable report. It is built only from sanitised records, so it contains
 * no headers, cookies, bodies or redacted values.
 */
export const sanitizedReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: timestampSchema,
  tool: z.strictObject({
    name: z.literal('api-qa-inspector'),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Expected a semver version'),
  }),
  session: z.strictObject({
    id: identifierSchema,
    name: nameSchema,
    source: captureSourceSchema,
    startedAt: timestampSchema,
    endedAt: timestampSchema.nullable(),
    requestCount: countSchema,
    droppedRequestCount: countSchema,
  }),
  ruleSetName: nameSchema,
  findings: z.array(reportedFindingSchema).max(LIMITS.findingsPerReport),
  endpoints: z.array(endpointStatsSchema).max(LIMITS.endpointsPerBaseline),
  regression: regressionResultSchema.nullable(),
});
export type SanitizedReport = z.infer<typeof sanitizedReportSchema>;
