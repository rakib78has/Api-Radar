import { httpMethodSchema, type HttpMethod } from '@api-qa/contracts';

/**
 * Converts a captured method string to its canonical form.
 *
 * Returns `undefined` when the value is not a known HTTP method, so callers
 * record the method as unavailable instead of guessing one.
 */
export function normalizeHttpMethod(raw: string): HttpMethod | undefined {
  const result = httpMethodSchema.safeParse(raw.trim().toUpperCase());
  return result.success ? result.data : undefined;
}
