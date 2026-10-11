import { z } from 'zod';

import { LIMITS, identifierSchema, nameSchema, textSchema } from './common.js';
import { httpMethodSchema } from './http-method.js';
import { resourceTypeSchema } from './request.js';

/**
 * Endpoint pattern. Either a path (`/api/users/:id`) or a full origin plus path
 * (`https://api.example.com/v1/**`). In the path:
 * - `:name` matches exactly one non-empty segment;
 * - `*` matches any characters inside one segment;
 * - `**` (a whole segment) matches zero or more segments.
 * Query strings are not part of a pattern.
 */
export const endpointPatternSchema = z
  .string()
  .min(1)
  .max(LIMITS.patternLength)
  .regex(
    /^(?:https?:\/\/[^/\s?#]+)?\/[^\s?#]*$/,
    'Must be a path starting with "/" or an http(s) origin followed by a path, without query or fragment',
  );

export const endpointMatcherSchema = z.strictObject({
  method: z.union([httpMethodSchema, z.literal('*')]).default('*'),
  path: endpointPatternSchema,
});
export type EndpointMatcher = z.infer<typeof endpointMatcherSchema>;

const optionalCount = z.number().int().nonnegative().max(1_000_000).nullable().default(null);

/** Rule D: expectations for one endpoint during a workflow. */
export const endpointRuleSchema = z
  .strictObject({
    id: identifierSchema,
    description: textSchema.default(''),
    match: endpointMatcherSchema,
    /** At least one call must happen. */
    required: z.boolean().default(false),
    /** No call may happen. */
    forbidden: z.boolean().default(false),
    expectedCount: optionalCount,
    minCount: optionalCount,
    maxCount: optionalCount,
    /** Requests matching this rule are ignored by every detector. */
    excluded: z.boolean().default(false),
    /** Overrides `retries.maxAttempts` for matching requests. */
    maxRetryAttempts: z.number().int().min(1).max(100).nullable().default(null),
  })
  .superRefine((rule, ctx) => {
    const hasCounts =
      rule.expectedCount !== null || rule.minCount !== null || rule.maxCount !== null;
    if (rule.forbidden && (rule.required || hasCounts)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A forbidden endpoint cannot also be required or have call counts',
      });
    }
    if (rule.excluded && (rule.required || rule.forbidden || hasCounts)) {
      ctx.addIssue({
        code: 'custom',
        message: 'An excluded endpoint cannot have other expectations',
      });
    }
    if (rule.minCount !== null && rule.maxCount !== null && rule.minCount > rule.maxCount) {
      ctx.addIssue({ code: 'custom', message: 'minCount must not exceed maxCount' });
    }
    if (rule.expectedCount !== null && (rule.minCount !== null || rule.maxCount !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use either expectedCount or minCount/maxCount, not both',
      });
    }
    if (rule.required && rule.expectedCount === 0) {
      ctx.addIssue({ code: 'custom', message: 'A required endpoint cannot expect 0 calls' });
    }
  });
export type EndpointRule = z.infer<typeof endpointRuleSchema>;

/** Rule B: the polling cadence a tester expects for an endpoint. */
export const pollingPolicySchema = z.strictObject({
  id: identifierSchema,
  match: endpointMatcherSchema,
  expectedIntervalMs: z.number().int().min(100).max(86_400_000),
  /** Fraction below the expected interval that is still acceptable (0.2 allows 20% faster). */
  tolerance: z.number().min(0).max(0.95).default(0.2),
});
export type PollingPolicy = z.infer<typeof pollingPolicySchema>;

const nameListSchema = z.array(z.string().min(1).max(LIMITS.nameLength)).max(LIMITS.namesPerList);

export const detectionRuleSetSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: nameSchema,
    description: textSchema.default(''),
    /** Request categories the detectors analyse. Requests whose type is unknown are always analysed. */
    resourceTypes: z.array(resourceTypeSchema).min(1).max(10).default(['api']),
    normalization: z
      .strictObject({
        /** Query parameters dropped before comparing requests, e.g. cache busters such as `_`. */
        ignoredQueryParams: nameListSchema.default([]),
        /** Extra parameter and body-field names to redact, on top of the built-in list. */
        sensitiveNames: nameListSchema.default([]),
        /** Body characters hashed before the body is treated as truncated. */
        maxBodyLength: z.number().int().min(1_024).max(LIMITS.rawBodyLength).default(1_048_576),
      })
      .prefault({}),
    duplicates: z
      .strictObject({
        enabled: z.boolean().default(true),
        /** Largest gap between two equivalent requests that still counts as a duplicate. */
        windowMs: z.number().int().min(1).max(600_000).default(1_000),
      })
      .prefault({}),
    retries: z
      .strictObject({
        enabled: z.boolean().default(true),
        /** Total attempts allowed per operation, including the first. */
        maxAttempts: z.number().int().min(1).max(100).default(3),
        /** Shortest acceptable delay between attempts; 0 disables the check. */
        minDelayMs: z.number().int().min(0).max(600_000).default(0),
        /** Longest gap after a failure that still links the next attempt to it. */
        windowMs: z.number().int().min(1).max(3_600_000).default(60_000),
      })
      .prefault({}),
    navigation: z
      .strictObject({
        enabled: z.boolean().default(true),
        /** Requests this soon after a navigation are tolerated (unload beacons, in-flight starts). */
        graceMs: z.number().int().min(0).max(60_000).default(100),
      })
      .prefault({}),
    polling: z.array(pollingPolicySchema).max(LIMITS.rulesPerSet).default([]),
    endpoints: z.array(endpointRuleSchema).max(LIMITS.rulesPerSet).default([]),
    /** Report API requests that match no endpoint rule or polling policy. */
    strictEndpoints: z.boolean().default(false),
    regression: z
      .strictObject({
        /** Allowed relative increase in an endpoint's request count. */
        countToleranceRatio: z.number().min(0).max(100).default(0),
        /** Allowed absolute increase in an endpoint's request count. */
        countToleranceAbsolute: z.number().int().min(0).max(1_000_000).default(0),
        /** Allowed increase in failure rate, in percentage points / 100. */
        failureRateTolerance: z.number().min(0).max(1).default(0.05),
        /** Allowed relative increase in p95 duration. */
        durationToleranceRatio: z.number().min(0).max(100).default(0.5),
        reportMissingEndpoints: z.boolean().default(true),
      })
      .prefault({}),
  })
  .superRefine((ruleSet, ctx) => {
    const seen = new Set<string>();
    for (const id of [...ruleSet.endpoints, ...ruleSet.polling].map((rule) => rule.id)) {
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate rule id "${id}"` });
      }
      seen.add(id);
    }
  });
export type DetectionRuleSet = z.infer<typeof detectionRuleSetSchema>;
/** A rule set as written in a file, before defaults are applied. */
export type DetectionRuleSetInput = z.input<typeof detectionRuleSetSchema>;

/** The rule set used when a tester has configured nothing. */
export const DEFAULT_RULE_SET: DetectionRuleSet = detectionRuleSetSchema.parse({
  schemaVersion: 1,
  name: 'Default',
});
