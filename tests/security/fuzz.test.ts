import {
  capturedRequestSchema,
  parseBaseline,
  parseCaptureSession,
  parseRuleSet,
  parseSanitizedReport,
  type RawRequestObservation,
} from '@api-qa/contracts';
import { analyzeRequests, compileEndpointPattern, normalizeRequest } from '@api-qa/core';
import { describe, expect, it } from 'vitest';

/** Deterministic PRNG (mulberry32): every run explores the same inputs. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const ALPHABET = [
  'a',
  'Z',
  '0',
  '/',
  '?',
  '&',
  '=',
  '%',
  '#',
  '@',
  ':',
  '.',
  '-',
  '_',
  ' ',
  '\u0000',
  'é',
  '😀',
  '\uD800',
  '"',
  '{',
  '}',
  '[',
  ']',
  '\\',
  '*',
  '+',
];

function randomString(random: () => number, max = 40): string {
  return Array.from(
    { length: Math.floor(random() * max) },
    () => ALPHABET[Math.floor(random() * ALPHABET.length)] ?? '',
  ).join('');
}

/** Random JSON-like values, including keys schemas care about and hostile ones. */
function randomValue(random: () => number, depth = 0): unknown {
  const pick = Math.floor(random() * (depth > 3 ? 6 : 9));
  switch (pick) {
    case 0:
      return null;
    case 1:
      return random() < 0.5;
    case 2:
      return [0, -1, 1.5, 1e308, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53][
        Math.floor(random() * 7)
      ];
    case 3:
      return randomString(random);
    case 4:
      return Math.floor(random() * 10);
    case 5:
      return undefined;
    case 6:
      return Array.from({ length: Math.floor(random() * 4) }, () => randomValue(random, depth + 1));
    default: {
      const keys = [
        'schemaVersion',
        'name',
        'endpoints',
        'polling',
        'requests',
        'match',
        'path',
        '__proto__',
        'constructor',
        randomString(random, 8),
      ];
      return Object.fromEntries(
        Array.from({ length: Math.floor(random() * 5) }, () => [
          keys[Math.floor(random() * keys.length)] ?? 'k',
          randomValue(random, depth + 1),
        ]),
      );
    }
  }
}

const PARSERS = { parseRuleSet, parseBaseline, parseCaptureSession, parseSanitizedReport };

describe('fuzzing untrusted-input parsers', () => {
  it.each(Object.entries(PARSERS))(
    '%s never throws and always returns a result',
    (_name, parse) => {
      const random = prng(7);
      for (let i = 0; i < 1_500; i++) {
        const input = i % 3 === 0 ? randomString(random, 200) : randomValue(random);
        const result = parse(input);
        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) {
          expect(result.issues.length).toBeGreaterThan(0);
          expect(result.issues.length).toBeLessThanOrEqual(20);
        }
      }
      expect(Object.prototype).not.toHaveProperty('schemaVersion');
    },
  );
});

describe('fuzzing request normalisation and matching', () => {
  it('normalizeRequest never throws, and every accepted request is schema-valid', () => {
    const random = prng(11);
    const prefixes = [
      'https://shop.test/',
      'http://127.0.0.1:8080/',
      'HTTPS://User:Pw@Shop.Test/',
      'ftp://x/',
      'javascript:',
      '',
      'https://[::1]/',
    ];
    let accepted = 0;
    for (let i = 0; i < 2_000; i++) {
      const raw: RawRequestObservation = {
        id: `f${String(i)}`,
        timestamp: random() < 0.05 ? -1 : random() * 2e12,
        source: 'playwright',
        method: ['GET', 'post', 'BREW', '', 'DeLeTe'][Math.floor(random() * 5)] ?? 'GET',
        url: `${prefixes[Math.floor(random() * prefixes.length)] ?? ''}${randomString(random, 80)}`,
        resourceType: random() < 0.3 ? null : randomString(random, 10),
        status: random() < 0.3 ? null : Math.floor(random() * 999),
        error: random() < 0.8 ? null : randomString(random, 60),
        durationMs: random() < 0.3 ? null : random() * 1e5,
        initiator: random() < 0.5 ? null : randomString(random, 40),
        context: {
          tabId: random() < 0.2 ? null : 1,
          frameId: 0,
          documentId: random() < 0.2 ? null : 'd',
        },
        body:
          random() < 0.5
            ? { kind: 'absent' }
            : {
                kind: 'text',
                text: randomString(random, 120),
                contentType: random() < 0.5 ? null : 'application/json',
              },
      };
      const result = normalizeRequest(raw);
      if (result.ok) {
        accepted++;
        expect(capturedRequestSchema.safeParse(result.request).success).toBe(true);
      }
    }
    expect(accepted).toBeGreaterThan(100);
  });

  it('endpoint patterns never throw on random paths', () => {
    const random = prng(13);
    for (let i = 0; i < 500; i++) {
      const matches = compileEndpointPattern(`/${randomString(random, 30)}`);
      expect(typeof matches('https://shop.test', `/${randomString(random, 60)}`)).toBe('boolean');
    }
  });

  it('analysis survives random but schema-valid sessions', () => {
    const random = prng(17);
    const requests = Array.from({ length: 300 }, (_, i) =>
      normalizeRequest({
        id: `r${String(i)}`,
        timestamp: Math.floor(random() * 10_000),
        source: 'playwright',
        method: random() < 0.5 ? 'GET' : 'POST',
        url: `https://shop.test/api/${String(Math.floor(random() * 5))}?q=${String(Math.floor(random() * 3))}`,
        resourceType: 'fetch',
        status: [200, 500, null][Math.floor(random() * 3)] ?? null,
        error: random() < 0.1 ? 'net::ERR_FAILED' : null,
        durationMs: random() * 100,
        initiator: null,
        context: {
          tabId: Math.floor(random() * 2),
          frameId: 0,
          documentId: `d${String(Math.floor(random() * 3))}`,
        },
        body: { kind: 'absent' },
      }),
    ).flatMap((result) => (result.ok ? [result.request] : []));
    const navigations = Array.from({ length: 10 }, (_, i) => ({
      id: `n${String(i)}`,
      timestamp: Math.floor(random() * 10_000),
      url: 'https://shop.test/',
      context: {
        tabId: Math.floor(random() * 2),
        frameId: 0,
        documentId: `d${String(Math.floor(random() * 3))}`,
      },
    }));
    const result = analyzeRequests({ requests, navigations });
    expect(result.analysedRequestCount).toBe(requests.length);
  });
});
