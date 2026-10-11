import { z } from 'zod';

import {
  LIMITS,
  countSchema,
  durationMsSchema,
  identifierSchema,
  nameSchema,
  timestampSchema,
} from './common.js';
import { findingSchema, findingTypeSchema } from './finding.js';

/** Per-endpoint request statistics, computed over analysed requests. */
export const endpointStatsSchema = z
  .strictObject({
    endpoint: z.string().min(1).max(LIMITS.urlLength),
    requestCount: countSchema,
    failureCount: countSchema,
    /** Requests that reported a duration; percentiles are `null` when this is 0. */
    timedRequestCount: countSchema,
    durationP50Ms: durationMsSchema.nullable(),
    durationP95Ms: durationMsSchema.nullable(),
  })
  .refine((stats) => stats.failureCount <= stats.requestCount, {
    message: 'failureCount must not exceed requestCount',
  })
  .refine((stats) => stats.timedRequestCount <= stats.requestCount, {
    message: 'timedRequestCount must not exceed requestCount',
  });
export type EndpointStats = z.infer<typeof endpointStatsSchema>;

/** Identifies a kind of finding on an endpoint, independent of request ids. */
export const findingKeySchema = z.strictObject({
  type: findingTypeSchema,
  endpoint: z.string().max(LIMITS.urlLength).nullable(),
});
export type FindingKey = z.infer<typeof findingKeySchema>;

export const baselineSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: nameSchema,
    createdAt: timestampSchema,
    ruleSetName: nameSchema,
    endpoints: z.array(endpointStatsSchema).max(LIMITS.endpointsPerBaseline),
    /** Findings that already existed when the baseline was recorded. */
    findingKeys: z.array(findingKeySchema).max(LIMITS.findingsPerReport),
  })
  .superRefine((baseline, ctx) => {
    const seen = new Set<string>();
    for (const [index, stats] of baseline.endpoints.entries()) {
      if (seen.has(stats.endpoint)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Duplicate endpoint',
          path: ['endpoints', index, 'endpoint'],
        });
      }
      seen.add(stats.endpoint);
    }
  });
export type Baseline = z.infer<typeof baselineSchema>;

export const regressionResultSchema = z.strictObject({
  baselineName: nameSchema,
  /** `true` when no regression finding was produced. */
  passed: z.boolean(),
  comparedEndpointCount: countSchema,
  findings: z.array(findingSchema).max(LIMITS.findingsPerReport),
  /** Id of the session the baseline was compared with, when known. */
  sessionId: identifierSchema.nullable(),
});
export type RegressionResult = z.infer<typeof regressionResultSchema>;
