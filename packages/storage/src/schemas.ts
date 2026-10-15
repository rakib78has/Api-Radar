import {
  LIMITS,
  captureSourceSchema,
  countSchema,
  identifierSchema,
  nameSchema,
  navigationEventSchema,
  timestampSchema,
  triageStatusSchema,
} from '@api-qa/contracts';
import { z } from 'zod';

/** Requests per stored chunk; appending rewrites one chunk, never the whole session. */
export const CHUNK_SIZE = 250;

export const sessionSummarySchema = z.strictObject({
  id: identifierSchema,
  name: nameSchema,
  source: captureSourceSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  requestCount: countSchema,
  droppedRequestCount: countSchema,
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionIndexSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessions: z.array(sessionSummarySchema).max(1_000),
});
export type SessionIndex = z.infer<typeof sessionIndexSchema>;

/** Everything about a session except its requests, which live in chunks. */
export const sessionMetaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifierSchema,
  name: nameSchema,
  source: captureSourceSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  requestCount: countSchema.max(LIMITS.requestsPerSession),
  chunkCount: countSchema,
  navigations: z.array(navigationEventSchema).max(LIMITS.navigationsPerSession),
  droppedRequestCount: countSchema,
  triage: z.record(identifierSchema, triageStatusSchema),
});
export type SessionMeta = z.infer<typeof sessionMetaSchema>;

export const retentionPolicySchema = z.strictObject({
  /** Oldest sessions beyond this count are deleted. */
  maxSessions: z.number().int().min(1).max(1_000).default(20),
  /** Sessions that ended longer ago than this are deleted. */
  maxAgeDays: z.number().int().min(1).max(3_650).default(30),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export const DEFAULT_RETENTION: RetentionPolicy = retentionPolicySchema.parse({});
