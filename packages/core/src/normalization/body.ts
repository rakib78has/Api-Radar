import type { BodyStatus, RawBody } from '@api-qa/contracts';

import { fnv1a64 } from '../hash.js';
import { REDACTED, type SensitiveNameMatcher } from './sensitive.js';

/** Deeper JSON is not canonicalised (and so not hashed); real API payloads are far shallower. */
export const MAX_JSON_DEPTH = 64;

export interface BodyFingerprint {
  readonly status: BodyStatus;
  /** `null` unless the body was captured completely and could be sanitised. */
  readonly hash: string | null;
}

/** Stable JSON text: object keys sorted, sensitive fields redacted. `null` if nested too deeply. */
export function canonicalJson(
  value: unknown,
  isSensitive: SensitiveNameMatcher,
  depth = 0,
): string | null {
  if (depth > MAX_JSON_DEPTH) {
    return null;
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const item of value) {
      const text = canonicalJson(item, isSensitive, depth + 1);
      if (text === null) {
        return null;
      }
      items.push(text);
    }
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const field: unknown = Reflect.get(value, key);
      const text = isSensitive(key)
        ? JSON.stringify(REDACTED)
        : canonicalJson(field, isSensitive, depth + 1);
      if (text === null) {
        return null;
      }
      entries.push(`${JSON.stringify(key)}:${text}`);
    }
    return `{${entries.join(',')}}`;
  }
  // JSON.parse only produces strings, numbers, booleans and null here.
  return JSON.stringify(value);
}

function canonicalForm(text: string, isSensitive: SensitiveNameMatcher): string {
  return text
    .split('&')
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const separator = piece.indexOf('=');
      const name = separator === -1 ? piece : piece.slice(0, separator);
      let decodedName = name;
      try {
        decodedName = decodeURIComponent(name.replace(/\+/g, ' '));
      } catch {
        // Keep the raw name; it still identifies the field.
      }
      return isSensitive(decodedName) ? `${name}=${REDACTED}` : piece;
    })
    .sort()
    .join('&');
}

function looksLikeJson(text: string, contentType: string | null): boolean {
  if (contentType !== null) {
    return contentType.toLowerCase().includes('json');
  }
  const start = text.trimStart().charAt(0);
  return start === '{' || start === '[';
}

/**
 * Fingerprints a request body without keeping it. JSON and form bodies are
 * canonicalised (key order ignored) and sensitive fields redacted before
 * hashing. Truncated or over-deep JSON bodies are not hashed at all, so no
 * unredacted content reaches a fingerprint.
 */
export function fingerprintBody(
  body: RawBody,
  maxBodyLength: number,
  isSensitive: SensitiveNameMatcher,
): BodyFingerprint {
  if (body.kind === 'absent' || body.kind === 'unavailable') {
    return { status: body.kind, hash: null };
  }
  const { text, contentType } = body;
  if (text.length > maxBodyLength) {
    return { status: 'truncated', hash: null };
  }

  if (looksLikeJson(text, contentType)) {
    let parsed: unknown;
    let isJson = true;
    try {
      parsed = JSON.parse(text);
    } catch {
      isJson = false;
    }
    if (isJson) {
      const canonical = canonicalJson(parsed, isSensitive);
      return canonical === null
        ? { status: 'truncated', hash: null }
        : { status: 'captured', hash: fnv1a64(`json:${canonical}`) };
    }
  }

  if (contentType?.toLowerCase().includes('application/x-www-form-urlencoded') === true) {
    return { status: 'captured', hash: fnv1a64(`form:${canonicalForm(text, isSensitive)}`) };
  }

  return { status: 'captured', hash: fnv1a64(`text:${text}`) };
}
