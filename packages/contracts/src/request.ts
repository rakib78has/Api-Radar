import { z } from 'zod';

import {
  LIMITS,
  captureSourceSchema,
  durationMsSchema,
  identifierSchema,
  timestampSchema,
} from './common.js';
import { httpMethodSchema } from './http-method.js';

/**
 * Resource categories after normalisation. `api` covers XHR and fetch; Chrome's
 * webRequest API reports both as `xmlhttprequest`, so they cannot be told apart.
 */
export const RESOURCE_TYPES = [
  'api',
  'document',
  'script',
  'stylesheet',
  'image',
  'font',
  'media',
  'websocket',
  'beacon',
  'other',
] as const;
export const resourceTypeSchema = z.enum(RESOURCE_TYPES);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

/** Whether a request body was seen, and how much of it reached the fingerprint. */
export const BODY_STATUSES = ['absent', 'captured', 'truncated', 'unavailable'] as const;
export const bodyStatusSchema = z.enum(BODY_STATUSES);
export type BodyStatus = z.infer<typeof bodyStatusSchema>;

const tabIdSchema = z.number().int().min(-1).nullable();
const frameIdSchema = z.number().int().min(-1).nullable();
const documentIdSchema = z.string().min(1).max(LIMITS.idLength).nullable();

/** Where a request came from. `null` means the capture source could not tell. */
export const requestContextSchema = z.strictObject({
  tabId: tabIdSchema,
  frameId: frameIdSchema,
  /** Chrome's documentId, or a runner-assigned id for the document that issued the request. */
  documentId: documentIdSchema,
});
export type RequestContext = z.infer<typeof requestContextSchema>;

// ---------------------------------------------------------------------------
// Raw capture input: produced by a capture adapter, held in memory only, and
// never persisted. `@api-qa/core` turns it into a sanitised CapturedRequest.
// ---------------------------------------------------------------------------

export const rawBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('absent') }),
  z.strictObject({ kind: z.literal('unavailable') }),
  z.strictObject({
    kind: z.literal('text'),
    text: z.string().max(LIMITS.rawBodyLength),
    contentType: z.string().max(LIMITS.nameLength).nullable(),
  }),
]);
export type RawBody = z.infer<typeof rawBodySchema>;

export const rawRequestObservationSchema = z.strictObject({
  id: identifierSchema,
  timestamp: timestampSchema,
  source: captureSourceSchema,
  method: z.string().max(32),
  url: z.string().max(LIMITS.rawUrlLength),
  resourceType: z.string().max(64).nullable(),
  status: z.number().int().min(0).max(999).nullable(),
  /** Network-level failure such as `net::ERR_CONNECTION_REFUSED`. */
  error: z.string().max(LIMITS.textLength).nullable(),
  durationMs: durationMsSchema.nullable(),
  initiator: z.string().max(LIMITS.rawUrlLength).nullable(),
  context: requestContextSchema,
  body: rawBodySchema,
});
export type RawRequestObservation = z.infer<typeof rawRequestObservationSchema>;

export const rawNavigationObservationSchema = z.strictObject({
  id: identifierSchema,
  timestamp: timestampSchema,
  url: z.string().max(LIMITS.rawUrlLength),
  context: requestContextSchema,
});
export type RawNavigationObservation = z.infer<typeof rawNavigationObservationSchema>;

// ---------------------------------------------------------------------------
// Sanitised, persistable records.
// ---------------------------------------------------------------------------

const hashSchema = z.string().regex(/^[0-9a-f]{16}$/, 'Expected a 16-digit hex hash');

/** Identity of a request for comparison. Contains hashes and templates, never raw secrets. */
export const requestFingerprintSchema = z.strictObject({
  /** `METHOD origin/path/:template`, the unit that rules, stats and baselines count. */
  endpoint: z.string().min(1).max(LIMITS.urlLength),
  /** Hash of method, origin, exact path, canonical query and body. Equal keys mean equivalent requests. */
  requestKey: hashSchema,
  /** Hash of the redacted, canonicalised body; `null` unless `bodyStatus` is captured or truncated. */
  bodyHash: hashSchema.nullable(),
  bodyStatus: bodyStatusSchema,
});
export type RequestFingerprint = z.infer<typeof requestFingerprintSchema>;

export const capturedRequestSchema = z.strictObject({
  id: identifierSchema,
  timestamp: timestampSchema,
  source: captureSourceSchema,
  method: httpMethodSchema,
  /** Scheme, host and port only. */
  origin: z.string().min(1).max(LIMITS.urlLength),
  /** Path with secret-looking segments replaced by placeholders such as `:token`. */
  path: z.string().min(1).max(LIMITS.urlLength),
  /** Display URL: origin, sanitised path and query with sensitive values redacted. No fragment or credentials. */
  url: z.string().min(1).max(LIMITS.urlLength),
  resourceType: resourceTypeSchema.nullable(),
  status: z.number().int().min(0).max(999).nullable(),
  error: z.string().max(LIMITS.textLength).nullable(),
  durationMs: durationMsSchema.nullable(),
  /** Origin of the initiating document, when the capture source reports one. */
  initiator: z.string().max(LIMITS.urlLength).nullable(),
  context: requestContextSchema,
  fingerprint: requestFingerprintSchema,
});
export type CapturedRequest = z.infer<typeof capturedRequestSchema>;

/** A top-level document navigation, used to detect requests that outlive their page. */
export const navigationEventSchema = z.strictObject({
  id: identifierSchema,
  timestamp: timestampSchema,
  url: z.string().min(1).max(LIMITS.urlLength),
  context: requestContextSchema,
});
export type NavigationEvent = z.infer<typeof navigationEventSchema>;
