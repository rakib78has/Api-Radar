import {
  DEFAULT_RULE_SET,
  LIMITS,
  type CapturedRequest,
  type DetectionRuleSet,
  type NavigationEvent,
  type RawNavigationObservation,
  type RawRequestObservation,
} from '@api-qa/contracts';

import { hashFields } from '../hash.js';
import { fingerprintBody } from './body.js';
import { normalizeHttpMethod } from './http-method.js';
import { normalizeResourceType } from './resource-type.js';
import { createSensitiveNameMatcher, redactUrlsInText } from './sensitive.js';
import { canonicalQueryKey, originOf, parseRequestUrl, type UrlRejectionReason } from './url.js';

export type NormalizationOptions = DetectionRuleSet['normalization'];

export type RequestRejectionReason =
  UrlRejectionReason | 'invalid-timestamp' | 'unsupported-method';

export type NormalizeRequestResult =
  | { readonly ok: true; readonly request: CapturedRequest }
  | { readonly ok: false; readonly reason: RequestRejectionReason };

/**
 * Turns raw capture input into a sanitised, persistable record.
 *
 * Rejections are explicit so capture adapters can count dropped requests
 * instead of silently losing them.
 */
export function normalizeRequest(
  raw: RawRequestObservation,
  options: NormalizationOptions = DEFAULT_RULE_SET.normalization,
): NormalizeRequestResult {
  if (!Number.isFinite(raw.timestamp) || raw.timestamp < 0) {
    return { ok: false, reason: 'invalid-timestamp' };
  }
  const method = normalizeHttpMethod(raw.method);
  if (method === undefined) {
    return { ok: false, reason: 'unsupported-method' };
  }
  const isSensitive = createSensitiveNameMatcher(options.sensitiveNames);
  const parsed = parseRequestUrl(raw.url, isSensitive);
  if (!parsed.ok) {
    return parsed;
  }
  const { origin, path, template, query, sanitizedUrl } = parsed.value;
  const endpoint = `${method} ${origin}${template}`;
  if (endpoint.length > LIMITS.urlLength) {
    return { ok: false, reason: 'url-too-long' };
  }

  const body = fingerprintBody(raw.body, options.maxBodyLength, isSensitive);
  // Only sanitised data is hashed: the sanitised path, the query without
  // sensitive values, and the redacted body hash.
  const requestKey = hashFields([
    method,
    origin,
    path,
    ...canonicalQueryKey(query, new Set(options.ignoredQueryParams)),
    `body:${body.status}:${body.hash ?? ''}`,
    body.status === 'truncated' && raw.body.kind === 'text' ? String(raw.body.text.length) : '',
  ]);

  return {
    ok: true,
    request: {
      id: raw.id,
      timestamp: raw.timestamp,
      source: raw.source,
      method,
      origin,
      path,
      url: sanitizedUrl,
      resourceType: normalizeResourceType(raw.resourceType),
      status: raw.status,
      error: raw.error === null ? null : redactUrlsInText(raw.error).slice(0, LIMITS.textLength),
      durationMs: raw.durationMs,
      initiator: raw.initiator === null ? null : originOf(raw.initiator),
      context: { ...raw.context },
      fingerprint: {
        endpoint,
        requestKey,
        bodyHash: body.hash,
        bodyStatus: body.status,
      },
    },
  };
}

export type NormalizeNavigationResult =
  | { readonly ok: true; readonly navigation: NavigationEvent }
  | { readonly ok: false; readonly reason: 'invalid-timestamp' | 'invalid-url' };

/**
 * Sanitises a top-level navigation. Non-http(s) documents (`about:blank`,
 * `chrome://newtab/`) are kept but recorded by scheme only.
 */
export function normalizeNavigation(
  raw: RawNavigationObservation,
  options: NormalizationOptions = DEFAULT_RULE_SET.normalization,
): NormalizeNavigationResult {
  if (!Number.isFinite(raw.timestamp) || raw.timestamp < 0) {
    return { ok: false, reason: 'invalid-timestamp' };
  }
  const parsed = parseRequestUrl(raw.url, createSensitiveNameMatcher(options.sensitiveNames));
  let url: string;
  if (parsed.ok) {
    url = parsed.value.sanitizedUrl;
  } else if (parsed.reason === 'unsupported-scheme') {
    url = new URL(raw.url).protocol;
  } else {
    return { ok: false, reason: 'invalid-url' };
  }
  return {
    ok: true,
    navigation: { id: raw.id, timestamp: raw.timestamp, url, context: { ...raw.context } },
  };
}
