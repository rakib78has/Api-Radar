import { z } from 'zod';

/**
 * Upper bounds for captured and imported data. They keep a hostile or corrupt
 * rule, baseline or session file from exhausting memory, and they bound the
 * size of every report.
 */
export const LIMITS = {
  idLength: 128,
  nameLength: 200,
  textLength: 2_000,
  patternLength: 2_048,
  /** Longest URL a captured request keeps. Longer URLs are rejected during normalisation. */
  urlLength: 16_384,
  /** Longest URL accepted as raw capture input (Chrome's own URL limit is 2 MiB). */
  rawUrlLength: 2_097_152,
  /** Longest raw request body accepted as capture input; normalisation hashes at most `maxBodyLength`. */
  rawBodyLength: 5_242_880,
  requestsPerSession: 50_000,
  navigationsPerSession: 5_000,
  rulesPerSet: 500,
  namesPerList: 200,
  findingsPerReport: 10_000,
  evidenceRequestIds: 100,
  evidenceMeasurements: 32,
  endpointsPerBaseline: 5_000,
  /** Largest JSON document `parseJsonDocument` accepts, in UTF-16 code units. */
  jsonDocumentLength: 20_971_520,
} as const;

/** Opaque identifier: request ids, rule ids, finding ids. */
export const identifierSchema = z
  .string()
  .min(1)
  .max(LIMITS.idLength)
  .regex(/^[A-Za-z0-9._:-]+$/, 'May contain only letters, digits, ".", "_", ":" and "-"');

export const nameSchema = z.string().trim().min(1).max(LIMITS.nameLength);

export const textSchema = z.string().max(LIMITS.textLength);

/** Milliseconds since the Unix epoch. */
export const timestampSchema = z.number().nonnegative();

/** A duration in milliseconds, capped at one day. */
export const durationMsSchema = z.number().nonnegative().max(86_400_000);

export const countSchema = z.number().int().nonnegative();

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const confidenceSchema = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof confidenceSchema>;

export const CAPTURE_SOURCES = [
  'extension-webrequest',
  'extension-devtools',
  'playwright',
] as const;
export const captureSourceSchema = z.enum(CAPTURE_SOURCES);
export type CaptureSource = z.infer<typeof captureSourceSchema>;
