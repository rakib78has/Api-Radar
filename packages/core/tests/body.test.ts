import type { RawBody } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { createSensitiveNameMatcher, fingerprintBody } from '../src/index.js';
import { canonicalJson, MAX_JSON_DEPTH } from '../src/normalization/body.js';

const isSensitive = createSensitiveNameMatcher([]);
const MAX = 1_024;

function text(body: string, contentType: string | null = 'application/json'): RawBody {
  return { kind: 'text', text: body, contentType };
}

function hashOf(body: RawBody): string | null {
  return fingerprintBody(body, MAX, isSensitive).hash;
}

describe('fingerprintBody', () => {
  it('reports absent and unavailable bodies without a hash', () => {
    expect(fingerprintBody({ kind: 'absent' }, MAX, isSensitive)).toEqual({
      status: 'absent',
      hash: null,
    });
    expect(fingerprintBody({ kind: 'unavailable' }, MAX, isSensitive)).toEqual({
      status: 'unavailable',
      hash: null,
    });
  });

  it('ignores JSON key order and whitespace', () => {
    expect(hashOf(text('{"a":1,"b":[1,2]}'))).toBe(hashOf(text('{ "b": [1, 2], "a": 1 }')));
  });

  it('distinguishes different JSON values and array order', () => {
    expect(hashOf(text('{"a":1}'))).not.toBe(hashOf(text('{"a":2}')));
    expect(hashOf(text('[1,2]'))).not.toBe(hashOf(text('[2,1]')));
    expect(hashOf(text('{"a":"1"}'))).not.toBe(hashOf(text('{"a":1}')));
  });

  it('redacts sensitive fields at any depth before hashing', () => {
    const a = text('{"user":"jane","password":"hunter2","nested":{"token":"t1"}}');
    const b = text('{"user":"jane","password":"letmein","nested":{"token":"t2"}}');
    expect(hashOf(a)).toBe(hashOf(b));
    expect(hashOf(a)).not.toBe(hashOf(text('{"user":"john","password":"hunter2"}')));
  });

  it('sniffs JSON when no content type is given', () => {
    expect(fingerprintBody(text(' {"b":1,"a":2}', null), MAX, isSensitive)).toEqual(
      fingerprintBody(text('{"a":2,"b":1}'), MAX, isSensitive),
    );
  });

  it('treats invalid JSON as text', () => {
    const result = fingerprintBody(text('{not json'), MAX, isSensitive);
    expect(result.status).toBe('captured');
    expect(result.hash).toBe(hashOf(text('{not json', 'text/plain')));
  });

  it('canonicalises and redacts form bodies', () => {
    const form = 'application/x-www-form-urlencoded; charset=UTF-8';
    expect(hashOf(text('b=2&a=1', form))).toBe(hashOf(text('a=1&b=2', form)));
    expect(hashOf(text('user=jane&password=one', form))).toBe(
      hashOf(text('password=two&user=jane', form)),
    );
    expect(hashOf(text('user=jane', form))).not.toBe(hashOf(text('user=john', form)));
    expect(hashOf(text('%E0%A4%A=1&pass%77ord=x', form))).toBe(
      hashOf(text('%E0%A4%A=1&pass%77ord=y', form)),
    );
  });

  it('hashes other text verbatim', () => {
    expect(hashOf(text('hello', 'text/plain'))).not.toBe(hashOf(text('hello!', 'text/plain')));
  });

  it('does not hash bodies longer than the limit', () => {
    expect(fingerprintBody(text('x'.repeat(MAX + 1), 'text/plain'), MAX, isSensitive)).toEqual({
      status: 'truncated',
      hash: null,
    });
  });

  it('does not hash JSON nested deeper than the limit', () => {
    const deep = `${'['.repeat(MAX_JSON_DEPTH + 2)}${']'.repeat(MAX_JSON_DEPTH + 2)}`;
    expect(fingerprintBody(text(deep), 10_000, isSensitive)).toEqual({
      status: 'truncated',
      hash: null,
    });
    const deepObject = `${'{"a":'.repeat(MAX_JSON_DEPTH + 2)}1${'}'.repeat(MAX_JSON_DEPTH + 2)}`;
    expect(fingerprintBody(text(deepObject), 10_000, isSensitive).hash).toBeNull();
  });

  it('handles a __proto__ key as ordinary data', () => {
    expect(hashOf(text('{"__proto__":{"x":1}}'))).not.toBe(hashOf(text('{"__proto__":{"x":2}}')));
  });
});

describe('canonicalJson', () => {
  it('produces sorted, redacted JSON text', () => {
    expect(canonicalJson({ b: 1, a: { secret: 's', c: [true, null] } }, isSensitive)).toBe(
      '{"a":{"c":[true,null],"secret":"[REDACTED]"},"b":1}',
    );
  });
});
