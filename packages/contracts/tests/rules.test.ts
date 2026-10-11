import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RULE_SET,
  LIMITS,
  detectionRuleSetSchema,
  endpointPatternSchema,
  endpointRuleSchema,
} from '../src/index.js';

const minimal = { schemaVersion: 1, name: 'Checkout' } as const;

describe('detectionRuleSetSchema', () => {
  it('fills every default from a minimal rule set', () => {
    expect(detectionRuleSetSchema.parse(minimal)).toEqual({
      schemaVersion: 1,
      name: 'Checkout',
      description: '',
      resourceTypes: ['api'],
      normalization: { ignoredQueryParams: [], sensitiveNames: [], maxBodyLength: 1_048_576 },
      duplicates: { enabled: true, windowMs: 1_000 },
      retries: { enabled: true, maxAttempts: 3, minDelayMs: 0, windowMs: 60_000 },
      navigation: { enabled: true, graceMs: 100 },
      polling: [],
      endpoints: [],
      strictEndpoints: false,
      regression: {
        countToleranceRatio: 0,
        countToleranceAbsolute: 0,
        failureRateTolerance: 0.05,
        durationToleranceRatio: 0.5,
        reportMissingEndpoints: true,
      },
    });
  });

  it('exposes the defaults as DEFAULT_RULE_SET', () => {
    expect(DEFAULT_RULE_SET.name).toBe('Default');
    expect(DEFAULT_RULE_SET.duplicates.windowMs).toBe(1_000);
  });

  it('keeps partial nested settings and fills the rest', () => {
    const parsed = detectionRuleSetSchema.parse({ ...minimal, retries: { maxAttempts: 5 } });
    expect(parsed.retries).toEqual({
      enabled: true,
      maxAttempts: 5,
      minDelayMs: 0,
      windowMs: 60_000,
    });
  });

  it.each([
    ['unknown top-level key', { ...minimal, extra: true }],
    ['misspelt nested key', { ...minimal, duplicates: { windowMS: 100 } }],
    ['__proto__ key from JSON', JSON.parse('{"schemaVersion":1,"name":"x","__proto__":{"a":1}}')],
    ['wrong schema version', { ...minimal, schemaVersion: 2 }],
    ['blank name', { ...minimal, name: '   ' }],
    ['negative window', { ...minimal, duplicates: { windowMs: -1 } }],
    ['fractional attempts', { ...minimal, retries: { maxAttempts: 2.5 } }],
    ['infinite tolerance', { ...minimal, regression: { countToleranceRatio: Infinity } }],
    ['empty resource types', { ...minimal, resourceTypes: [] }],
    ['unknown resource type', { ...minimal, resourceTypes: ['api', 'gopher'] }],
  ])('rejects a rule set with a %s', (_label, input) => {
    expect(detectionRuleSetSchema.safeParse(input).success).toBe(false);
  });

  it('rejects duplicate rule ids across endpoints and polling policies', () => {
    const result = detectionRuleSetSchema.safeParse({
      ...minimal,
      endpoints: [{ id: 'dup', match: { path: '/a' } }],
      polling: [{ id: 'dup', match: { path: '/b' }, expectedIntervalMs: 1_000 }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Duplicate rule id "dup"');
  });

  it('rejects more rules than the limit', () => {
    const endpoints = Array.from({ length: LIMITS.rulesPerSet + 1 }, (_, i) => ({
      id: `r${String(i)}`,
      match: { path: '/a' },
    }));
    expect(detectionRuleSetSchema.safeParse({ ...minimal, endpoints }).success).toBe(false);
  });
});

describe('endpointRuleSchema', () => {
  const rule = (extra: object) => ({ id: 'r', match: { path: '/api/x' }, ...extra });

  it('defaults the method to any and every expectation to off', () => {
    expect(endpointRuleSchema.parse(rule({}))).toEqual({
      id: 'r',
      description: '',
      match: { method: '*', path: '/api/x' },
      required: false,
      forbidden: false,
      expectedCount: null,
      minCount: null,
      maxCount: null,
      excluded: false,
      maxRetryAttempts: null,
    });
  });

  it.each([
    ['forbidden and required', { forbidden: true, required: true }],
    ['forbidden with counts', { forbidden: true, maxCount: 1 }],
    ['excluded and required', { excluded: true, required: true }],
    ['excluded with counts', { excluded: true, minCount: 1 }],
    ['min above max', { minCount: 3, maxCount: 2 }],
    ['exact and range counts', { expectedCount: 1, maxCount: 2 }],
    ['required with zero expected', { required: true, expectedCount: 0 }],
    ['lower-case method', { match: { method: 'get', path: '/x' } }],
    ['id with spaces', { id: 'my rule' }],
  ])('rejects %s', (_label, extra) => {
    expect(endpointRuleSchema.safeParse(rule(extra)).success).toBe(false);
  });

  it('accepts consistent combinations', () => {
    expect(endpointRuleSchema.safeParse(rule({ required: true, maxCount: 2 })).success).toBe(true);
    expect(endpointRuleSchema.safeParse(rule({ minCount: 2, maxCount: 2 })).success).toBe(true);
  });
});

describe('endpointPatternSchema', () => {
  it.each([
    '/',
    '/api/users/:id',
    '/api/**',
    'https://api.example.com/v1/*',
    'http://localhost:3000/',
  ])('accepts %j', (pattern) => {
    expect(endpointPatternSchema.safeParse(pattern).success).toBe(true);
  });

  it.each([
    '',
    'api/users',
    '/api?x=1',
    '/api#frag',
    '/api users',
    'https://api.example.com',
    'ftp://files/x',
    `/${'a'.repeat(LIMITS.patternLength)}`,
  ])('rejects %j', (pattern) => {
    expect(endpointPatternSchema.safeParse(pattern).success).toBe(false);
  });
});
