import { HTTP_METHODS } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { normalizeHttpMethod } from '../src/index.js';

describe('normalizeHttpMethod', () => {
  it.each(HTTP_METHODS)('keeps the canonical method %s unchanged', (method) => {
    expect(normalizeHttpMethod(method)).toBe(method);
  });

  it.each([
    ['get', 'GET'],
    ['Patch', 'PATCH'],
    ['  delete\t', 'DELETE'],
    ['\noptions\n', 'OPTIONS'],
  ] as const)('normalises %j to %s', (raw, expected) => {
    expect(normalizeHttpMethod(raw)).toBe(expected);
  });

  it.each(['', '   ', 'FETCH', 'G E T', 'GET\u0000', 'GETX', 'x'.repeat(10_000)])(
    'returns undefined for the unknown method %j',
    (raw) => {
      expect(normalizeHttpMethod(raw)).toBeUndefined();
    },
  );
});
