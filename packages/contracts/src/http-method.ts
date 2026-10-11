import { z } from 'zod';

/** HTTP request methods defined by RFC 9110 and RFC 5789 (PATCH). */
export const HTTP_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
] as const;

/** Accepts only a canonical (upper-case) method name. Normalisation belongs in `@api-qa/core`. */
export const httpMethodSchema = z.enum(HTTP_METHODS);

export type HttpMethod = z.infer<typeof httpMethodSchema>;
