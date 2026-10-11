import { LIMITS } from '@api-qa/contracts';

import { REDACTED, type SensitiveNameMatcher } from './sensitive.js';

/** How a path segment is treated in the sanitised path and the endpoint template. */
export type SegmentKind = 'literal' | 'id' | 'uuid' | 'token' | 'email';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
const DIGITS = /^\d+$/;
const HEX = /^[0-9a-f]+$/i;
const OPAQUE = /^[\w.~+=-]+$/;

/**
 * Classifies one path segment. Tokens and e-mail addresses are redacted from
 * stored paths; ids and UUIDs are kept (they are evidence) but templated.
 */
export function classifySegment(segment: string): SegmentKind {
  if (segment.length === 0) {
    return 'literal';
  }
  if (segment.includes('@') || /%40/i.test(segment)) {
    return 'email';
  }
  if (JWT.test(segment)) {
    return 'token';
  }
  if (UUID.test(segment)) {
    return 'uuid';
  }
  if (DIGITS.test(segment)) {
    return 'id';
  }
  if (HEX.test(segment) && /\d/.test(segment)) {
    if (segment.length >= 32) {
      return 'token';
    }
    if (segment.length >= 16) {
      return 'id';
    }
  }
  if (
    segment.length >= 32 &&
    OPAQUE.test(segment) &&
    /\d/.test(segment) &&
    /[a-z]/.test(segment) &&
    /[A-Z]/.test(segment)
  ) {
    return 'token';
  }
  return 'literal';
}

const PLACEHOLDERS: Readonly<Record<Exclude<SegmentKind, 'literal'>, string>> = {
  id: ':id',
  uuid: ':uuid',
  token: ':token',
  email: ':email',
};

export interface QueryParam {
  readonly name: string;
  /** `null` for a bare flag such as `?debug`. */
  readonly value: string | null;
  readonly sensitive: boolean;
}

export interface ParsedRequestUrl {
  /** Scheme, lower-cased host and non-default port. */
  readonly origin: string;
  /** Path with tokens and e-mail addresses replaced by `:token` / `:email`. */
  readonly path: string;
  /** Path with every variable segment replaced by its placeholder. */
  readonly template: string;
  readonly query: readonly QueryParam[];
  /** Display URL: origin, sanitised path and query with sensitive values redacted. */
  readonly sanitizedUrl: string;
}

export type UrlRejectionReason = 'invalid-url' | 'unsupported-scheme' | 'url-too-long';

export type ParseUrlResult =
  | { readonly ok: true; readonly value: ParsedRequestUrl }
  | { readonly ok: false; readonly reason: UrlRejectionReason };

function safeDecode(component: string): string {
  try {
    return decodeURIComponent(component.replace(/\+/g, ' '));
  } catch {
    return component;
  }
}

function parseQuery(search: string, isSensitive: SensitiveNameMatcher): QueryParam[] {
  return search
    .replace(/^\?/, '')
    .split('&')
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const separator = piece.indexOf('=');
      const name = safeDecode(separator === -1 ? piece : piece.slice(0, separator));
      const value = separator === -1 ? null : safeDecode(piece.slice(separator + 1));
      return { name, value, sensitive: isSensitive(name) };
    });
}

function formatQuery(query: readonly QueryParam[]): string {
  if (query.length === 0) {
    return '';
  }
  const parts = query.map((param) => {
    const name = encodeURIComponent(param.name);
    if (param.value === null) {
      return name;
    }
    return `${name}=${param.sensitive ? REDACTED : encodeURIComponent(param.value)}`;
  });
  return `?${parts.join('&')}`;
}

/** Parses and sanitises an http(s) request URL. Credentials and fragments are dropped. */
export function parseRequestUrl(raw: string, isSensitive: SensitiveNameMatcher): ParseUrlResult {
  if (raw.length > LIMITS.urlLength) {
    return { ok: false, reason: 'url-too-long' };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-scheme' };
  }

  const segments = url.pathname.split('/');
  const kinds = segments.map(classifySegment);
  const path = segments
    .map((segment, index) => {
      const kind = kinds[index];
      return kind === 'token' || kind === 'email' ? PLACEHOLDERS[kind] : segment;
    })
    .join('/');
  const template = segments
    .map((segment, index) => {
      const kind = kinds[index] ?? 'literal';
      return kind === 'literal' ? segment : PLACEHOLDERS[kind];
    })
    .join('/');

  const query = parseQuery(url.search, isSensitive);
  const sanitizedUrl = `${url.origin}${path}${formatQuery(query)}`;
  if (sanitizedUrl.length > LIMITS.urlLength) {
    return { ok: false, reason: 'url-too-long' };
  }

  return { ok: true, value: { origin: url.origin, path, template, query, sanitizedUrl } };
}

/** `scheme://host[:port]` of an http(s) URL, or `null` for anything else (including `"null"`). */
export function originOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Query parameters in a canonical, order-independent form for fingerprints.
 * Ignored parameters are dropped; sensitive ones contribute only their name.
 */
export function canonicalQueryKey(
  query: readonly QueryParam[],
  ignoredNames: ReadonlySet<string>,
): string[] {
  return query
    .filter((param) => !ignoredNames.has(param.name))
    .map((param) => {
      if (param.value === null) {
        return param.name;
      }
      return param.sensitive ? `${param.name}=\u0000` : `${param.name}=${param.value}`;
    })
    .sort();
}
