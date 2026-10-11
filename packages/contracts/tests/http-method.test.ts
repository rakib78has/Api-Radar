import { describe, expect, it } from 'vitest';

import { HTTP_METHODS, httpMethodSchema } from '../src/index.js';

describe('httpMethodSchema', () => {
  it.each(HTTP_METHODS)('accepts the canonical method %s', (method) => {
    expect(httpMethodSchema.parse(method)).toBe(method);
  });

  it.each(['get', 'Post', ' GET', 'GET ', '', 'FETCH', 'GET\u0000'])(
    'rejects the non-canonical value %j',
    (value) => {
      expect(httpMethodSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each([null, undefined, 42, {}, ['GET']])('rejects the non-string value %j', (value) => {
    expect(httpMethodSchema.safeParse(value).success).toBe(false);
  });
});
