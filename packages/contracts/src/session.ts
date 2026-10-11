import { z } from 'zod';

import {
  LIMITS,
  captureSourceSchema,
  countSchema,
  identifierSchema,
  nameSchema,
  timestampSchema,
} from './common.js';
import { triageStatusSchema } from './finding.js';
import { capturedRequestSchema, navigationEventSchema } from './request.js';

export const captureSessionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: identifierSchema,
    name: nameSchema,
    source: captureSourceSchema,
    startedAt: timestampSchema,
    /** `null` while the capture is still running. */
    endedAt: timestampSchema.nullable(),
    requests: z.array(capturedRequestSchema).max(LIMITS.requestsPerSession),
    navigations: z.array(navigationEventSchema).max(LIMITS.navigationsPerSession),
    /** Requests seen but not recorded (unsupported scheme, over the session limit, ...). */
    droppedRequestCount: countSchema,
    /** Tester decisions keyed by finding id. */
    triage: z
      .record(identifierSchema, triageStatusSchema)
      .refine((value) => Object.keys(value).length <= LIMITS.findingsPerReport, {
        message: `At most ${String(LIMITS.findingsPerReport)} triage entries`,
      }),
  })
  .refine((session) => session.endedAt === null || session.endedAt >= session.startedAt, {
    message: 'endedAt must not be earlier than startedAt',
    path: ['endedAt'],
  });
export type CaptureSession = z.infer<typeof captureSessionSchema>;
